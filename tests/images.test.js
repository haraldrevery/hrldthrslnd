/**
 * images.js — the _min mirror.
 *
 * These tests deliberately pre-create the counterparts so no codec is ever
 * initialised: the behaviour under test is which files the mirror thinks it
 * owns, not how well it compresses. Encoding is exercised by running a real
 * build; the bookkeeping is what silently produced wrong pictures.
 */
import { test, expect, describe, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import { mirrorDirectory } from "../eleventy_binary/lib/images.js";
import { makeProject, removeProject, quietly } from "./helpers.js";

const created = [];
function project(files) {
  const root = makeProject(files);
  created.push(root);
  return root;
}
afterEach(() => {
  while (created.length) removeProject(created.pop());
});

/** A real JPEG header, so readImageHeader() can measure it. */
function jpeg(width, height) {
  const head = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08]);
  const dims = Buffer.alloc(4);
  dims.writeUInt16BE(height, 0);
  dims.writeUInt16BE(width, 2);
  return Buffer.concat([head, dims, Buffer.alloc(64)]).toString("binary");
}

describe("mirrorDirectory — counterpart ownership", () => {
  test("two images differing only in extension are reported, not silently merged", async () => {
    // a.jpg and a.png both want a_min.jpg. Before this was detected the second
    // found the first's file already on disk, counted it as "existing", and
    // every card and og:image for it showed the wrong photograph.
    const root = project({
      "image/a.jpg": jpeg(1000, 500),
      "image/a.png": jpeg(400, 400),
      "image_min/a_min.jpg": jpeg(500, 250),
    });

    const report = await quietly(() =>
      mirrorDirectory(path.join(root, "image"), path.join(root, "image_min"), {
        label: "image_min",
      }),
    );

    expect(report.collisions).toHaveLength(1);
    expect(report.collisions[0]).toMatchObject({
      first: "a.jpg",
      second: "a.png",
      target: "image_min/a_min.jpg",
    });
  });

  test("the loser is not also reported as stale, which would give wrong advice", async () => {
    // The shape check would otherwise fire on the second image and tell the
    // author to delete the counterpart — which regenerates it from whichever
    // file the walk reaches first, so the same collision comes straight back.
    const root = project({
      "image/a.jpg": jpeg(1000, 500),
      "image/a.png": jpeg(400, 400),
      "image_min/a_min.jpg": jpeg(500, 250),
    });

    const report = await quietly(() =>
      mirrorDirectory(path.join(root, "image"), path.join(root, "image_min"), {
        label: "image_min",
      }),
    );

    expect(report.stale).toEqual([]);
  });

  test("which image keeps the counterpart does not depend on the filesystem", async () => {
    // The walk sorts in code-unit order, so the same pair always resolves the
    // same way and the report names the same file twice running.
    const files = {
      "image/a.png": jpeg(400, 400),
      "image/a.jpg": jpeg(1000, 500),
      "image_min/a_min.jpg": jpeg(500, 250),
    };
    const first = await quietly(() =>
      mirrorDirectory(
        path.join(project(files), "image"),
        path.join(created[created.length - 1], "image_min"),
        { label: "image_min" },
      ),
    );
    expect(first.collisions[0].first).toBe("a.jpg");
    expect(first.collisions[0].second).toBe("a.png");
  });

  test("distinct basenames are left alone", async () => {
    const root = project({
      "image/a.jpg": jpeg(1000, 500),
      "image/b.jpg": jpeg(800, 600),
      "image_min/a_min.jpg": jpeg(500, 250),
      "image_min/b_min.jpg": jpeg(400, 300),
    });

    const report = await quietly(() =>
      mirrorDirectory(path.join(root, "image"), path.join(root, "image_min"), {
        label: "image_min",
      }),
    );

    expect(report.collisions).toEqual([]);
    expect(report.existing).toBe(2);
  });

  test("a name that is already a counterpart is not itself mirrored", async () => {
    const root = project({
      "image/a.jpg": jpeg(1000, 500),
      "image/a_min.jpg": jpeg(500, 250),
      "image_min/a_min.jpg": jpeg(500, 250),
    });

    const report = await quietly(() =>
      mirrorDirectory(path.join(root, "image"), path.join(root, "image_min"), {
        label: "image_min",
      }),
    );

    // a_min.jpg is filtered out of the walk, so it neither collides with a.jpg
    // nor asks for an a_min_min.jpg of its own.
    expect(report.collisions).toEqual([]);
    expect(report.existing).toBe(1);
  });

  test("reports carry a collisions array even when nothing collides", async () => {
    // generateMissingThumbnails() and the status page both read this field.
    const root = project({ "image/a.jpg": jpeg(10, 10), "image_min/a_min.jpg": jpeg(10, 10) });
    const report = await quietly(() =>
      mirrorDirectory(path.join(root, "image"), path.join(root, "image_min"), {}),
    );
    expect(Array.isArray(report.collisions)).toBe(true);
  });
});
