/**
 * build.mjs refuses to start rather than build the wrong site.
 *
 * Two ways a build used to go ahead and replace a good _site/: an option it
 * did not know was ignored (`--stirct` published the build it was meant to
 * refuse), and a configuration file that did not parse was replaced by its
 * defaults (a broken site_settings.json published the whole site under
 * example.com). Each test here puts a marker in _site/ first and checks it
 * survives.
 */
import { test, expect, describe, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { makeProject, removeProject, frontMatter } from "./helpers.js";

const REPO = path.resolve(import.meta.dirname, "..");

const created = [];
afterEach(() => {
  while (created.length) removeProject(created.pop());
});

function project(files = {}) {
  const root = makeProject({
    "site_settings.json": JSON.stringify({ name: "T", url: "https://t.test" }),
    "input_markdown/a.md": frontMatter({ title: "A", date: "2026-01-01" }),
    "_site/marker.txt": "previous build",
    ...files,
  });
  created.push(root);
  return root;
}

const run = (root, ...args) =>
  spawnSync("bun", ["run", path.join(REPO, "eleventy_binary/build.mjs"), ...args], { cwd: root, encoding: "utf8" });

const untouched = (root) =>
  fs.readFileSync(path.join(root, "_site/marker.txt"), "utf8") === "previous build" &&
  !fs.existsSync(path.join(root, "_site.tmp"));

describe("options", () => {
  test("an unknown option stops before anything is built", () => {
    const root = project();
    const result = run(root, "--no-css", "--stirct");
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('unknown option "--stirct"');
    expect(untouched(root)).toBe(true);
  });

  test("an option that takes a value refuses to go without one", () => {
    const root = project();
    expect(run(root, "--edit", "--port").stderr).toContain("--port needs a value");
    expect(run(root, "--edit", "--port", "abc").stderr).toContain("--port needs a port number");
    expect(run(root, "--check-post").status).toBe(2);
  });
});

describe("configuration files", () => {
  for (const [file, content, says] of [
    ["site_settings.json", '{ "name": "T", }', "not valid JSON"],
    ["site_settings.json", "[]", "not a JSON object"],
    ["category.json", "{ categories: [] }", "not valid JSON"],
    ["published_urls.json", '{ "pages": ', "not valid JSON"],
    ["published_urls.json", "{}", 'no "pages" object'],
  ]) {
    test(`${file} that cannot be read (${says}) leaves the previous build in place`, () => {
      const root = project({ [file]: content });
      const result = run(root, "--no-css");
      expect(result.status).toBe(1);
      expect(result.stdout + result.stderr).toContain(`${file} cannot be read`);
      expect(result.stdout + result.stderr).toContain(says);
      expect(untouched(root)).toBe(true);
    });
  }

  test("--check-only still runs, and reports the file instead", () => {
    const root = project({ "category.json": "{ nope" });
    const result = run(root, "--check-only");
    expect(result.stdout + result.stderr).not.toContain("Nothing was built");
    expect(result.stdout + result.stderr).toContain("category.json");
  });
});
