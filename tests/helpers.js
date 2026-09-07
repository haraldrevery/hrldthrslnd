/**
 * Shared test helpers.
 *
 * Every test that builds a registry works against a throwaway project tree
 * rather than this repository: buildRegistry() reads whatever is on disk, and a
 * test that depended on the real input folders would start failing the moment
 * a post was added.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** A temporary project root containing exactly the given files. */
export function makeProject(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "site_generate-test-"));
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

export function removeProject(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

/**
 * Run `fn` with the console silenced.
 *
 * The build logger prints as a side effect of being called, and several of
 * these tests deliberately trigger warnings. Without this the test output is
 * mostly build warnings from fixtures.
 */
export function quietly(fn) {
  const { log, error, warn } = console;
  console.log = () => {};
  console.error = () => {};
  console.warn = () => {};
  try {
    return fn();
  } finally {
    Object.assign(console, { log, error, warn });
  }
}

/** Front matter block plus a one-line body, as a source file would hold it. */
export function frontMatter(fields, body = "body") {
  const lines = Object.entries(fields).map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join("\n")}\n---\n${body}\n`;
}
