/**
 * imagesize.js — intrinsic dimensions from file headers.
 *
 * Why this matters more than it looks: the width and height it returns are what
 * reserve space before an image arrives. Without them the page shifts on load,
 * and a `loading="lazy"` image collapses to zero height, never enters the
 * viewport and is therefore never loaded at all. "Measured nothing" is not a
 * cosmetic failure, it is an invisible picture.
 */
import { test, expect, describe, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import { readImageHeader } from "../eleventy_binary/lib/imagesize.js";
import { makeProject, removeProject } from "./helpers.js";

const created = [];
function project(files) {
  const root = makeProject(files);
  created.push(root);
  return root;
}
afterEach(() => {
  while (created.length) removeProject(created.pop());
});

const SOI = Buffer.from([0xff, 0xd8]);
const EOI = Buffer.from([0xff, 0xd9]);

/** A Start Of Frame segment declaring the given size. */
function sof(width, height, marker = 0xc0) {
  const b = Buffer.alloc(19);
  b[0] = 0xff;
  b[1] = marker;
  b.writeUInt16BE(17, 2); // length covers everything after the marker
  b[4] = 8; // sample precision
  b.writeUInt16BE(height, 5);
  b.writeUInt16BE(width, 7);
  b[9] = 3; // three components
  return b;
}

/** An arbitrary marker segment with a payload of `payloadLength` zero bytes. */
function segment(marker, payloadLength) {
  const b = Buffer.alloc(4 + payloadLength);
  b[0] = 0xff;
  b[1] = marker;
  b.writeUInt16BE(2 + payloadLength, 2);
  return b;
}

/** An ICC profile as cameras and editors actually embed one: chunked APP2. */
function iccProfile(totalBytes) {
  const chunks = [];
  let left = totalBytes;
  while (left > 0) {
    const payload = Math.min(65000, left);
    left -= payload;
    chunks.push(segment(0xe2, payload));
  }
  return Buffer.concat(chunks);
}

const jpeg = (...parts) => Buffer.concat([SOI, ...parts, EOI]);

describe("readImageHeader — JPEG", () => {
  test("a plain baseline JPEG", () => {
    const root = project({ "a.jpg": jpeg(sof(2800, 1750)) });
    expect(readImageHeader(path.join(root, "a.jpg"))).toEqual({
      width: 2800,
      height: 1750,
    });
  });

  test("the .jpeg spelling too", () => {
    const root = project({ "a.jpeg": jpeg(sof(10, 20)) });
    expect(readImageHeader(path.join(root, "a.jpeg"))).toEqual({ width: 10, height: 20 });
  });

  test("a progressive JPEG (SOF2) is measured like any other", () => {
    const root = project({ "a.jpg": jpeg(sof(640, 480, 0xc2)) });
    expect(readImageHeader(path.join(root, "a.jpg"))).toEqual({ width: 640, height: 480 });
  });

  test("an embedded ICC profile does not hide the frame header", () => {
    // The case this was rewritten for. A colour-managed export carries a
    // profile of several hundred kB in chunked APP2 segments, all of which sit
    // ahead of the SOF. Reading a fixed 64 kB prefix measured nothing for
    // exactly the files a photography site is made of.
    for (const kb of [64, 200, 560, 2048]) {
      const root = project({ "a.jpg": jpeg(iccProfile(kb * 1024), sof(4000, 3000)) });
      expect(readImageHeader(path.join(root, "a.jpg"))).toEqual({
        width: 4000,
        height: 3000,
      });
    }
  });

  test("EXIF, XMP and a comment ahead of the frame are all stepped over", () => {
    const root = project({
      "a.jpg": jpeg(
        segment(0xe1, 40000), // APP1 / EXIF
        segment(0xe1, 30000), // APP1 / XMP
        segment(0xfe, 500), // COM
        segment(0xdb, 130), // DQT
        sof(1200, 900),
      ),
    });
    expect(readImageHeader(path.join(root, "a.jpg"))).toEqual({ width: 1200, height: 900 });
  });

  test("standalone markers carry no length and must not be read as if they did", () => {
    // TEM and the restart markers are two bytes with no length field. Treating
    // the next two bytes as a length walks the parser into the middle of the
    // file.
    const root = project({
      "a.jpg": jpeg(Buffer.from([0xff, 0x01]), segment(0xe0, 16), sof(300, 200)),
    });
    expect(readImageHeader(path.join(root, "a.jpg"))).toEqual({ width: 300, height: 200 });
  });

  test("fill bytes before a marker are legal padding", () => {
    const root = project({
      "a.jpg": jpeg(Buffer.from([0xff, 0xff, 0xff]), sof(50, 25)),
    });
    expect(readImageHeader(path.join(root, "a.jpg"))).toEqual({ width: 50, height: 25 });
  });

  test("no frame header before the scan data means no answer", () => {
    // Everything after SOS is entropy-coded; there is nothing left to find.
    const root = project({ "a.jpg": jpeg(segment(0xda, 12)) });
    expect(readImageHeader(path.join(root, "a.jpg"))).toBe(null);
  });

  test("a file that is not a JPEG is not guessed at", () => {
    const root = project({ "a.jpg": Buffer.from("this is plain text, at length") });
    expect(readImageHeader(path.join(root, "a.jpg"))).toBe(null);
  });

  test("a truncated file returns null rather than throwing", () => {
    const root = project({
      "soi.jpg": SOI,
      "cut.jpg": Buffer.concat([SOI, segment(0xe2, 60000).subarray(0, 100)]),
      "empty.jpg": Buffer.alloc(0),
    });
    for (const name of ["soi.jpg", "cut.jpg", "empty.jpg"]) {
      expect(readImageHeader(path.join(root, name))).toBe(null);
    }
  });

  test("a zero length field cannot spin the parser", () => {
    const bad = Buffer.from([0xff, 0xe0, 0x00, 0x00]);
    const root = project({ "a.jpg": jpeg(bad, sof(10, 10)) });
    expect(readImageHeader(path.join(root, "a.jpg"))).toBe(null);
  });
});

describe("readImageHeader — other formats", () => {
  test("PNG", () => {
    const png = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47]).copy(png, 0);
    png.writeUInt32BE(800, 16);
    png.writeUInt32BE(600, 20);
    const root = project({ "a.png": png });
    expect(readImageHeader(path.join(root, "a.png"))).toEqual({ width: 800, height: 600 });
  });

  test("GIF, which is little endian unlike the rest", () => {
    const gif = Buffer.alloc(10);
    Buffer.from("GIF89a").copy(gif, 0);
    gif.writeUInt16LE(120, 6);
    gif.writeUInt16LE(90, 8);
    const root = project({ "a.gif": gif });
    expect(readImageHeader(path.join(root, "a.gif"))).toEqual({ width: 120, height: 90 });
  });

  test("SVG by viewBox, falling back to width and height", () => {
    const root = project({
      "box.svg": '<svg viewBox="0 0 64 32" xmlns="http://www.w3.org/2000/svg"></svg>',
      "attrs.svg": '<svg width="200px" height="100px" xmlns="http://www.w3.org/2000/svg"></svg>',
      "neither.svg": '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    });
    expect(readImageHeader(path.join(root, "box.svg"))).toEqual({ width: 64, height: 32 });
    expect(readImageHeader(path.join(root, "attrs.svg"))).toEqual({ width: 200, height: 100 });
    expect(readImageHeader(path.join(root, "neither.svg"))).toBe(null);
  });

  test("a format with no reader, a missing file and a directory are all null", () => {
    const root = project({ "a.mp4": Buffer.alloc(64), "sub/x.txt": "x" });
    expect(readImageHeader(path.join(root, "a.mp4"))).toBe(null);
    expect(readImageHeader(path.join(root, "gone.jpg"))).toBe(null);
    expect(readImageHeader(path.join(root, "sub"))).toBe(null);
  });

  test("reading many files does not run the process out of descriptors", () => {
    // Every read opens a handle; closing it used to sit after the parse rather
    // than in a finally, so any throw in between leaked one. This runs for
    // every image in every post.
    const files = {};
    for (let i = 0; i < 400; i += 1) files[`bad${i}.jpg`] = Buffer.from("not a jpeg at all");
    const root = project(files);
    for (let i = 0; i < 400; i += 1) {
      expect(readImageHeader(path.join(root, `bad${i}.jpg`))).toBe(null);
    }
  });
});
