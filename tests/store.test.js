/**
 * editor/store.js — the only way the page builder touches the disk.
 *
 * The properties under test are the safety ones: a save is atomic and keeps
 * the version it replaced, an upload never overwrites, and nothing accepts a
 * name that reaches outside input_custom_post/.
 */
import { test, expect, describe, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import {
  writePost, readPost, createPost, listPosts, listAssets, writeAsset, freeName,
  revisionsOf, readRevision, StoreError, REVISIONS,
} from "../eleventy_binary/lib/editor/store.js";
import { makeProject, removeProject, quietly } from "./helpers.js";

const created = [];
function project(files) {
  const root = makeProject({ "site_settings.json": "{}", ...files });
  created.push(root);
  return root;
}
afterEach(() => {
  while (created.length) removeProject(created.pop());
});

const doc = (title) => ({ format: 1, meta: { title, date: "2026-01-01" }, blocks: [] });

describe("documents", () => {
  test("create, read, and the folder joins the registry", () => {
    const root = project({});
    createPost(root, "trip", doc("Trip"));
    expect(readPost(root, "trip").doc.meta.title).toBe("Trip");
    const posts = quietly(() => listPosts(root));
    expect(posts.map((p) => p.folder)).toEqual(["trip"]);
    expect(posts[0].source).toBe("json");
  });

  test("creating over an existing folder is refused", () => {
    const root = project({ "input_custom_post/trip/trip.json": "{}" });
    expect(() => createPost(root, "trip", doc("x"))).toThrow(StoreError);
  });

  test("an explicit save keeps the previous version; autosave keeps one only after the gap", () => {
    const root = project({});
    createPost(root, "trip", doc("v1"));
    writePost(root, "trip", doc("v2"), { revision: true });
    writePost(root, "trip", doc("v3"), { revision: false });
    writePost(root, "trip", doc("v4"), { revision: false });
    const revisions = revisionsOf(root, "trip");
    expect(revisions).toHaveLength(1);
    expect(readRevision(root, "trip", revisions[0].name).meta.title).toBe("v1");
    expect(readPost(root, "trip").doc.meta.title).toBe("v4");
    expect(fs.existsSync(path.join(root, "input_custom_post/trip/trip.json.tmp"))).toBe(false);
  });

  test("an unchanged save keeps no revision", () => {
    const root = project({});
    createPost(root, "trip", doc("v1"));
    writePost(root, "trip", doc("v1"), { revision: true });
    expect(revisionsOf(root, "trip")).toHaveLength(0);
  });

  test("the revisions folder is hidden from the build and the asset list", () => {
    const root = project({});
    createPost(root, "trip", doc("v1"));
    writePost(root, "trip", doc("v2"), { revision: true });
    expect(REVISIONS.startsWith(".")).toBe(true);
    expect(listAssets(root, "trip")).toEqual([]);
  });

  test("names that leave the folder are refused before any path is built", () => {
    const root = project({});
    for (const bad of ["../x", "a/b", ".hidden", "", "x y"]) {
      expect(() => readPost(root, bad)).toThrow(StoreError);
    }
    expect(() => readRevision(root, "trip", "../../site_settings.json")).toThrow(StoreError);
  });
});

describe("assets", () => {
  test("an upload never overwrites: the same name fails, freeName steps aside", () => {
    const root = project({});
    createPost(root, "trip", doc("t"));
    writeAsset(root, "trip", "a.jpg", Buffer.from("one"));
    expect(() => writeAsset(root, "trip", "a.jpg", Buffer.from("two"))).toThrow(/already exists/);
    expect(fs.readFileSync(path.join(root, "input_custom_post/trip/a.jpg"), "utf8")).toBe("one");
    expect(freeName(root, "trip", "a.jpg")).toBe("a_2.jpg");
    expect(freeName(root, "trip", "b.jpg")).toBe("b.jpg");
  });

  test("the listing knows kinds and whether a counterpart exists", () => {
    const root = project({});
    createPost(root, "trip", doc("t"));
    writeAsset(root, "trip", "a.jpg", Buffer.from("x"));
    writeAsset(root, "trip", "a_min.jpg", Buffer.from("x"));
    writeAsset(root, "trip", "b.png", Buffer.from("x"));
    writeAsset(root, "trip", "c.mp4", Buffer.from("x"));
    const byName = Object.fromEntries(listAssets(root, "trip").map((a) => [a.name, a]));
    expect(byName["a.jpg"].hasMin).toBe(true);
    expect(byName["b.png"].hasMin).toBe(false);
    expect(byName["a_min.jpg"].isMin).toBe(true);
    expect(byName["c.mp4"].kind).toBe("video");
  });

  test("an asset name is checked", () => {
    const root = project({});
    createPost(root, "trip", doc("t"));
    expect(() => writeAsset(root, "trip", "../x.jpg", Buffer.from("x"))).toThrow(StoreError);
    expect(() => writeAsset(root, "trip", ".revisions", Buffer.from("x"))).toThrow(StoreError);
  });
});
