/**
 * front_matter.js — the pre-pass that runs before Eleventy exists.
 *
 * This module is a SECOND front matter parser: Eleventy uses gray-matter, and
 * the registry cannot, because it has to know a page's `draft` and `permalink`
 * before Eleventy has been constructed. The two therefore have to agree, and
 * every case below is a place where they once did not or could not.
 *
 * The rule for `draft` is deliberately conservative: match Eleventy's reading
 * rather than being generous, because being wrong in the "this is a draft"
 * direction unpublishes a page nobody asked to unpublish.
 */
import { test, expect, describe } from "bun:test";
import {
  frontMatterBlock,
  stripFrontMatter,
  hasKey,
  hasValue,
  firstToken,
  isDraft,
} from "../eleventy_binary/lib/front_matter.js";

describe("frontMatterBlock", () => {
  test("reads the block between the fences", () => {
    expect(frontMatterBlock("---\ntitle: x\n---\nbody")).toBe("title: x");
  });

  test("a file with no block returns null, not an empty string", () => {
    expect(frontMatterBlock("just a body")).toBe(null);
  });

  test("CRLF line endings are read the same as LF", () => {
    expect(frontMatterBlock("---\r\ntitle: x\r\n---\r\nbody")).toBe("title: x");
  });

  test("a UTF-8 byte order mark does not hide the block", () => {
    // Editors on Windows write one before the opening fence. gray-matter strips
    // it, so Eleventy reads the block; this must too or the two disagree.
    expect(frontMatterBlock("﻿---\ntitle: x\n---\nbody")).toBe("title: x");
  });

  test("trailing whitespace on a fence does not hide the block", () => {
    // gray-matter accepts these. An invisible space after --- used to make this
    // parser report "no front matter" on a file that had one — which reported
    // two spurious errors AND published a draft's co-located assets, because
    // the registry read `draft` as absent.
    expect(frontMatterBlock("--- \ntitle: x\n--- \nbody")).toBe("title: x");
    expect(frontMatterBlock("---\t\ntitle: x\n---\t\nbody")).toBe("title: x");
    expect(frontMatterBlock("--- \r\ntitle: x\n--- \r\nbody")).toBe("title: x");
  });

  test("a --- inside the body does not end the block early", () => {
    expect(frontMatterBlock("---\ntitle: x\n---\nbody\n---\nmore")).toBe("title: x");
  });

  test("the fence must open the file", () => {
    expect(frontMatterBlock("text\n---\ntitle: x\n---\n")).toBe(null);
  });
});

describe("stripFrontMatter", () => {
  test("removes the block and leaves the body", () => {
    expect(stripFrontMatter("---\ntitle: x\n---\nbody")).toBe("body");
  });

  test("content with no block is returned unchanged", () => {
    expect(stripFrontMatter("# Heading")).toBe("# Heading");
  });

  test("strips a block whose fences carry trailing whitespace", () => {
    expect(stripFrontMatter("--- \ntitle: x\n--- \n# Heading")).toBe("# Heading");
  });
});

describe("hasKey and hasValue", () => {
  const block = frontMatterBlock(
    "---\ntitle: A post\nempty:\ntags:\n  - one\n  - two\nnote: text # comment\n---\n",
  );

  test("a key with a value", () => {
    expect(hasKey(block, "title")).toBe(true);
    expect(hasValue(block, "title")).toBe(true);
  });

  test("a key with nothing after the colon is present but has no value", () => {
    // `title:` renders an empty <h1> and `date:` becomes the Unix epoch, so
    // these two states have to be distinguishable.
    expect(hasKey(block, "empty")).toBe(true);
    expect(hasValue(block, "empty")).toBe(false);
  });

  test("an empty line followed by an indented block IS a value", () => {
    expect(hasValue(block, "tags")).toBe(true);
  });

  test("a key that is not there at all", () => {
    expect(hasKey(block, "missing")).toBe(false);
    expect(hasValue(block, "missing")).toBe(false);
  });

  test("a value that is only a comment does not count", () => {
    const onlyComment = frontMatterBlock("---\ntitle: # nothing\n---\n");
    expect(hasKey(onlyComment, "title")).toBe(true);
    expect(hasValue(onlyComment, "title")).toBe(false);
  });

  test("a key written with no value does not swallow the next line", () => {
    // `date:` above `description: hello` used to read as the token
    // "description:", so the status check reported the wrong key by name.
    const b = frontMatterBlock("---\ndate:\ndescription: hello\n---\n");
    expect(firstToken(b, "date")).toBe(null);
    expect(firstToken(b, "description")).toBe("hello");
  });
});

describe("firstToken", () => {
  test("takes the first token, so a trailing comment is discounted", () => {
    const b = frontMatterBlock("---\ndraft: true # for now\n---\n");
    expect(firstToken(b, "draft")).toBe("true");
  });

  test("quotes are left on, because they change the meaning", () => {
    const b = frontMatterBlock(`---\ndraft: "true"\n---\n`);
    expect(firstToken(b, "draft")).toBe(`"true"`);
  });

  test("a # that does not follow whitespace is part of the value", () => {
    const b = frontMatterBlock("---\ntitle:#1\n---\n");
    expect(firstToken(b, "title")).toBe("#1");
  });
});

describe("isDraft", () => {
  test("only an unquoted true, in any case, is a draft", () => {
    expect(isDraft(frontMatterBlock("---\ndraft: true\n---\n"))).toBe(true);
    expect(isDraft(frontMatterBlock("---\ndraft: True\n---\n"))).toBe(true);
    expect(isDraft(frontMatterBlock("---\ndraft: TRUE\n---\n"))).toBe(true);
  });

  test("values YAML does not read as boolean true are NOT drafts", () => {
    // Eleventy's preprocessor tests `data.draft === true`. `yes` and `1` parse
    // as a string and a number there, so treating them as drafts here would
    // unpublish a page Eleventy is publishing.
    for (const value of ["false", "yes", "1", `"true"`, "'true'"]) {
      expect(isDraft(frontMatterBlock(`---\ndraft: ${value}\n---\n`))).toBe(false);
    }
  });

  test("a draft is still a draft behind a trailing-whitespace fence", () => {
    expect(isDraft(frontMatterBlock("--- \ndraft: true\n--- \n"))).toBe(true);
  });

  test("no block, and no draft key, are both 'not a draft'", () => {
    expect(isDraft(null)).toBe(false);
    expect(isDraft(frontMatterBlock("---\ntitle: x\n---\n"))).toBe(false);
  });

  test("KNOWN LIMIT: an indented top-level key is not seen", () => {
    // YAML allows a uniformly indented mapping; this line-anchored parser does
    // not read it, and loosening the anchor would instead make a NESTED
    // `draft:` under another key look top-level — a false positive, which is
    // the more damaging direction. Pinned so the trade-off stays deliberate.
    expect(isDraft(frontMatterBlock("---\n  draft: true\n---\n"))).toBe(false);
  });
});
