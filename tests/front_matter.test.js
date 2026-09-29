/**
 * front_matter.js — the pre-pass that runs before Eleventy exists.
 *
 * A line reader for the status check, which asks what an author WROTE — is the
 * key there, does it carry a value — rather than what YAML makes of it. What a
 * page means (is it a draft, where does it publish) is read with Eleventy's own
 * parser in slugs.js; tests/slugs.test.js pins those readings.
 */
import { test, expect, describe } from "bun:test";
import {
  frontMatterBlock,
  stripFrontMatter,
  hasKey,
  hasValue,
  firstToken,
  wholeValue,
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

describe("wholeValue", () => {
  test("keeps everything after the colon, where firstToken keeps one token", () => {
    const b = frontMatterBlock("---\npermalink: /my page.html\n---\n");
    expect(firstToken(b, "permalink")).toBe("/my");
    expect(wholeValue(b, "permalink")).toBe("/my page.html");
  });

  test("a trailing comment is still discounted", () => {
    const b = frontMatterBlock("---\npermalink: /a.html # for now\n---\n");
    expect(wholeValue(b, "permalink")).toBe("/a.html");
  });

  test("an absent key is null; a key with no value is the empty string", () => {
    const b = frontMatterBlock("---\npermalink:\ntitle: t\n---\n");
    expect(wholeValue(b, "nothing")).toBeNull();
    expect(wholeValue(b, "permalink")).toBe("");
  });
});
