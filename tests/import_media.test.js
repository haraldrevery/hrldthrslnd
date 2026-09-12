/**
 * import_media.js — what a photograph dropped into the editor comes out as.
 *
 * Runs the real codecs, so the file under test is a real JPEG: a small one,
 * encoded here, with an XMP packet put on it the way Lightroom or ExifTool
 * would have.
 */
import { test, expect, describe, beforeAll } from "bun:test";

import { importMedia } from "../eleventy_binary/lib/editor/import_media.js";
import { initCodecs, encodeJpeg } from "../eleventy_binary/lib/codecs.js";
import { readExif, describedAs, embedXmp } from "../eleventy_binary/lib/exif.js";
import { makeImage } from "../eleventy_binary/lib/thumbnail.js";

let photo;
beforeAll(async () => {
  await initCodecs();
  const width = 96;
  const height = 64;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) data.set([(i * 7) % 256, (i * 3) % 256, (i * 11) % 256, 255], i * 4);
  const jpeg = Buffer.from(await encodeJpeg(makeImage(data, width, height), { quality: 95 }));
  photo = embedXmp(jpeg, { title: "Säfsen", caption: "Selfie in Säfsen, Sweden January 27, 2024", creator: "Harald Revery", rights: "Harald Revery" });
});

describe("importMedia", () => {
  test("the file's title and description become the picture's title and caption, never its alt", async () => {
    const result = await importMedia({ name: "Säfsen selfie.jpg", bytes: photo, settings: {} });
    expect(result.primary).toBe("Safsen_selfie.jpg");
    expect(result.suggested).toMatchObject({ title: "Säfsen", caption: "Selfie in Säfsen, Sweden January 27, 2024" });
    expect(result.suggested.alt).toBeUndefined();
    expect(result.notices.some((n) => n.message === "title and caption read from the file")).toBe(true);
    // Under the budget, so the original is kept as it came.
    expect(Buffer.compare(result.files.find((f) => f.role === "primary").bytes, photo)).toBe(0);
  });

  test("a re-encoded original still says what it is: the four lines come back as XMP", async () => {
    const result = await importMedia({ name: "safsen.jpg", bytes: photo, settings: { status_check: { max_image_bytes: 200 } } });
    const primary = result.files.find((f) => f.role === "primary").bytes;
    expect(Buffer.compare(primary, photo)).not.toBe(0);
    expect(describedAs(readExif(primary))).toEqual({
      title: "Säfsen",
      caption: "Selfie in Säfsen, Sweden January 27, 2024",
      creator: "Harald Revery",
      rights: "Harald Revery",
    });
    expect(result.notices.find((n) => n.message === "camera data dropped by the re-encode").detail)
      .toBe("the title, caption, creator and rights were written back into the new file as XMP");
    expect(result.files.some((f) => f.role === "min")).toBe(true);
  });
});
