/**
 * exif.js — reading the few tags the site uses, and scrubbing GPS in place.
 *
 * The fixtures are built by hand, byte by byte, so the tests state exactly
 * what a file contains. A real camera JPEG would be a much better fixture and
 * a much worse test: it would pass or fail for reasons nobody can read.
 */
import { test, expect, describe } from "bun:test";
import { readExif, stripGps } from "../eleventy_binary/lib/exif.js";
import { orientImage, makeImage } from "../eleventy_binary/lib/thumbnail.js";

/**
 * A little TIFF builder. Entries: { tag, type, value } where value is a
 * number (SHORT/LONG), a string (ASCII), a Buffer (UNDEFINED) or, for a
 * sub-IFD pointer, { ifd: [...entries] }.
 */
function tiff(entries, { le = true } = {}) {
  const chunks = [];
  let cursor = 8; // header
  const header = Buffer.alloc(8);
  header.write(le ? "II" : "MM", 0, "ascii");
  const w16 = (b, v, at) => (le ? b.writeUInt16LE(v, at) : b.writeUInt16BE(v, at));
  const w32 = (b, v, at) => (le ? b.writeUInt32LE(v, at) : b.writeUInt32BE(v, at));
  w16(header, 0x2a, 2);
  w32(header, 8, 4);

  const blobs = []; // out-of-line values, appended after the IFDs
  const ifds = []; // [{at, buffer}]

  function layoutIfd(list) {
    const at = cursor;
    const size = 2 + list.length * 12 + 4;
    cursor += size;
    const buffer = Buffer.alloc(size);
    w16(buffer, list.length, 0);
    ifds.push({ at, buffer });
    list.forEach((entry, i) => {
      const e = 2 + i * 12;
      w16(buffer, entry.tag, e);
      if (entry.value && entry.value.ifd) {
        const sub = layoutIfd(entry.value.ifd);
        w16(buffer, 4, e + 2);
        w32(buffer, 1, e + 4);
        w32(buffer, sub, e + 8);
      } else if (typeof entry.value === "number") {
        w16(buffer, entry.type ?? 3, e + 2);
        w32(buffer, 1, e + 4);
        if ((entry.type ?? 3) === 3) w16(buffer, entry.value, e + 8);
        else w32(buffer, entry.value, e + 8);
      } else {
        const bytes = typeof entry.value === "string" ? Buffer.from(`${entry.value}\0`, "utf8") : entry.value;
        const type = entry.type ?? 2;
        const unit = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1 }[type];
        w16(buffer, type, e + 2);
        w32(buffer, bytes.length / unit, e + 4); // COUNT is in units of the type, not bytes
        if (bytes.length <= 4) bytes.copy(buffer, e + 8);
        else blobs.push({ bytes, patch: (offset) => w32(buffer, offset, e + 8) });
      }
    });
    return at;
  }
  layoutIfd(entries);

  for (const blob of blobs) {
    blob.patch(cursor);
    chunks.push({ at: cursor, buffer: blob.bytes });
    cursor += blob.bytes.length;
  }
  const out = Buffer.alloc(cursor);
  header.copy(out, 0);
  for (const { at, buffer } of [...ifds, ...chunks]) buffer.copy(out, at);
  return out;
}

/** SOI, an Exif APP1 holding `tiffBytes`, optionally an XMP APP1, a stub frame and EOI. */
function jpeg(tiffBytes, xmp = null) {
  const segments = [Buffer.from([0xff, 0xd8])];
  const exifPayload = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiffBytes]);
  const app1 = Buffer.alloc(4);
  app1[0] = 0xff; app1[1] = 0xe1; app1.writeUInt16BE(exifPayload.length + 2, 2);
  segments.push(app1, exifPayload);
  if (xmp) {
    const payload = Buffer.concat([Buffer.from("http://ns.adobe.com/xap/1.0/\0", "latin1"), Buffer.from(xmp, "utf8")]);
    const head = Buffer.alloc(4);
    head[0] = 0xff; head[1] = 0xe1; head.writeUInt16BE(payload.length + 2, 2);
    segments.push(head, payload);
  }
  segments.push(Buffer.from([0xff, 0xda, 0x00, 0x02, 0xff, 0xd9]));
  return Buffer.concat(segments);
}

const gpsIfd = [
  { tag: 0x0001, value: "N" },
  { tag: 0x0002, type: 5, value: Buffer.alloc(24, 0x11) }, // three rationals
  { tag: 0x0003, value: "E" },
  { tag: 0x0004, type: 5, value: Buffer.alloc(24, 0x22) },
];

function fixture({ le = true, gps = true, xmp = null } = {}) {
  const entries = [
    { tag: 0x010e, value: "A view of the lake" },
    { tag: 0x0112, value: 6 },
    { tag: 0x013b, value: "H" },
    { tag: 0x9c9b, type: 7, value: Buffer.from("Lake\0", "utf16le") },
    { tag: 0x8769, value: { ifd: [{ tag: 0x9003, value: "2026:07:04 12:00:00" }] } },
  ];
  if (gps) entries.push({ tag: 0x8825, value: { ifd: gpsIfd } });
  return jpeg(tiff(entries, { le }), xmp);
}

describe("readExif", () => {
  test("reads the tags the site uses, in both byte orders", () => {
    for (const le of [true, false]) {
      const exif = readExif(fixture({ le }));
      expect(exif.present).toBe(true);
      expect(exif.orientation).toBe(6);
      expect(exif.description).toBe("A view of the lake");
      expect(exif.artist).toBe("H");
      expect(exif.xpTitle).toBe("Lake");
      expect(exif.dateTimeOriginal).toBe("2026:07:04 12:00:00");
      expect(exif.hasGps).toBe(true);
    }
  });

  test("a file with no GPS block says so; XMP GPS is seen separately", () => {
    expect(readExif(fixture({ gps: false })).hasGps).toBe(false);
    const withXmp = readExif(fixture({ gps: false, xmp: '<x:xmpmeta><rdf:Description exif:GPSLatitude="59,20.5N"/></x:xmpmeta>' }));
    expect(withXmp.hasGps).toBe(false);
    expect(withXmp.xmpGps).toBe(true);
  });

  test("not a JPEG, a truncated file and garbage all read as no EXIF", () => {
    expect(readExif(Buffer.from("not a jpeg")).present).toBe(false);
    // Cut inside the TIFF header: whatever it answers, it answers without throwing and finds no GPS.
    expect(readExif(fixture().subarray(0, 20)).hasGps).toBe(false);
    expect(readExif(fixture().subarray(0, 40)).hasGps).toBe(false);
    expect(readExif(Buffer.alloc(0)).present).toBe(false);
  });
});

describe("stripGps", () => {
  test("empties the GPS directory and its values and leaves everything else", () => {
    const before = fixture();
    const { buffer, changed, removed } = stripGps(before);
    expect(changed).toBe(true);
    expect(removed).toEqual(["EXIF GPS directory"]);
    expect(buffer.length).toBe(before.length);

    const after = readExif(buffer);
    expect(after.hasGps).toBe(true); // the pointer is still there…
    expect(after.orientation).toBe(6); // …and so is everything else
    expect(after.description).toBe("A view of the lake");
    // …but the directory it points at is empty and the rational data is zero.
    expect(buffer.includes(Buffer.alloc(24, 0x11))).toBe(false);
    expect(buffer.includes(Buffer.alloc(24, 0x22))).toBe(false);
    expect(before.includes(Buffer.alloc(24, 0x11))).toBe(true);
  });

  test("blanks XMP GPS values without changing the packet's length", () => {
    const xmp = '<x:xmpmeta><rdf:Description exif:GPSLatitude="59,20.5N" exif:GPSLongitude="18,3.2E"><exif:GPSAltitude>12/1</exif:GPSAltitude></rdf:Description></x:xmpmeta>';
    const before = fixture({ gps: false, xmp });
    const { buffer, changed, removed } = stripGps(before);
    expect(changed).toBe(true);
    expect(removed).toEqual(["XMP GPS values"]);
    expect(buffer.length).toBe(before.length);
    const text = buffer.toString("latin1");
    expect(text).not.toContain("59,20.5N");
    expect(text).not.toContain("18,3.2E");
    expect(text).not.toContain("12/1");
    expect(text).toContain('exif:GPSLatitude="        "');
    expect(readExif(buffer).xmpGps).toBe(true); // the attribute names remain, blank
  });

  test("a file without GPS is returned unchanged", () => {
    const before = fixture({ gps: false });
    const { buffer, changed } = stripGps(before);
    expect(changed).toBe(false);
    expect(Buffer.compare(buffer, before)).toBe(0);
  });

  test("does not mutate the input", () => {
    const before = fixture();
    const copy = Buffer.from(before);
    stripGps(before);
    expect(Buffer.compare(before, copy)).toBe(0);
  });
});

describe("orientImage", () => {
  // A 2x1 image: red on the left, blue on the right.
  const red = [255, 0, 0, 255];
  const blue = [0, 0, 255, 255];
  const px = (image, x, y) => Array.from(image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4));
  const source = () => makeImage(new Uint8ClampedArray([...red, ...blue]), 2, 1);

  test("orientation 1 and nonsense leave the image alone", () => {
    expect(orientImage(source(), 1).width).toBe(2);
    expect(orientImage(source(), undefined).width).toBe(2);
  });
  test("6 turns it clockwise: red ends up on top", () => {
    const out = orientImage(source(), 6);
    expect([out.width, out.height]).toEqual([1, 2]);
    expect(px(out, 0, 0)).toEqual(red);
    expect(px(out, 0, 1)).toEqual(blue);
  });
  test("8 turns it anticlockwise: blue ends up on top", () => {
    const out = orientImage(source(), 8);
    expect(px(out, 0, 0)).toEqual(blue);
    expect(px(out, 0, 1)).toEqual(red);
  });
  test("3 is a half turn; 2 mirrors", () => {
    expect(px(orientImage(source(), 3), 0, 0)).toEqual(blue);
    expect(px(orientImage(source(), 2), 0, 0)).toEqual(blue);
  });
});
