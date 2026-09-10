/**
 * subjects.js — `tags` and `category` folded into one subject list.
 *
 * The cases below are the shapes an author actually writes and the two places
 * they used to diverge: a bare scalar, which Eleventy splits on commas but does
 * not trim, and capitalisation, which turned one subject into two pages
 * fighting over one URL.
 */
import { test, expect, describe } from "bun:test";
import { subjectList, foldSubject, mergeSubjects } from "../eleventy_binary/lib/subjects.js";

describe("subjectList", () => {
  test("a flow sequence is taken as written", () => {
    expect(subjectList(["test", "template"])).toEqual(["test", "template"]);
  });

  test("a bare scalar splits on commas", () => {
    // `tags: test, template`. Eleventy splits this itself; `category:` is not a
    // key it knows, so without this the whole line became one subject.
    expect(subjectList("test, template")).toEqual(["test", "template"]);
  });

  test("a bare scalar with no comma is a single subject", () => {
    expect(subjectList("test")).toEqual(["test"]);
  });

  test("members are trimmed", () => {
    // The bug this exists to close: Eleventy hands over [" template"], with a
    // leading space, for `tags: test, template`. That is invisible in an editor
    // and made " template" a different subject from "template".
    expect(subjectList(["test", " template"])).toEqual(["test", "template"]);
    expect(subjectList("  spaced  ,  out  ")).toEqual(["spaced", "out"]);
  });

  test("both spellings of the same list agree", () => {
    expect(subjectList("test, template")).toEqual(subjectList(["test", "template"]));
  });

  test("empty and absent values are an empty list", () => {
    expect(subjectList(null)).toEqual([]);
    expect(subjectList(undefined)).toEqual([]);
    expect(subjectList("")).toEqual([]);
    expect(subjectList([])).toEqual([]);
    // `category: [a, , b]` — a hole is not a subject.
    expect(subjectList(["a", null, "", "  ", "b"])).toEqual(["a", "b"]);
  });

  test("non-string members are stringified", () => {
    // `tags: [2026, true]` is legal YAML.
    expect(subjectList([2026, true])).toEqual(["2026", "true"]);
  });

  test("a quoted member of a list keeps its comma", () => {
    // The split is confined to a bare scalar, which is Eleventy's own rule for
    // `tags`, so an explicit list is the way to write a subject containing one.
    expect(subjectList(["Wine, women and song"])).toEqual(["Wine, women and song"]);
  });
});

describe("foldSubject", () => {
  test("case is not part of a subject's identity", () => {
    expect(foldSubject("Astronomy")).toBe(foldSubject("astronomy"));
    expect(foldSubject(" ASTRONOMY ")).toBe("astronomy");
  });

  test("punctuation is, so C++ and C# stay apart", () => {
    // headingSlug() reduces both to "c"; folding on it would merge them into
    // one subject, which is worse than the suffixed URL they get instead.
    expect(foldSubject("C++")).not.toBe(foldSubject("C#"));
  });

  test("absent values fold to nothing", () => {
    expect(foldSubject(null)).toBe("");
    expect(foldSubject(undefined)).toBe("");
  });
});

describe("mergeSubjects", () => {
  test("tags and categories become one list", () => {
    expect(mergeSubjects(["test", "template"], ["Astronomy"]))
      .toEqual(["test", "template", "Astronomy"]);
  });

  test("a subject named by both keys appears once", () => {
    expect(mergeSubjects(["test"], ["Test"])).toEqual(["test"]);
  });

  test("the first spelling wins, and tags are passed first", () => {
    // So adding a category cannot restyle the chips on a post that already had
    // tags.
    expect(mergeSubjects(["astronomy"], ["Astronomy"])).toEqual(["astronomy"]);
    expect(mergeSubjects(undefined, ["Astronomy"])).toEqual(["Astronomy"]);
  });

  test("duplicates within one key collapse too", () => {
    expect(mergeSubjects(["test", "Test", "TEST"])).toEqual(["test"]);
  });

  test("both YAML formats reach the same merged list", () => {
    expect(mergeSubjects("test, template", "Astronomy, Survival"))
      .toEqual(mergeSubjects(["test", "template"], ["Astronomy", "Survival"]));
  });

  test("a page with neither key gets an empty list", () => {
    expect(mergeSubjects(undefined, undefined)).toEqual([]);
    expect(mergeSubjects([], null)).toEqual([]);
  });
});
