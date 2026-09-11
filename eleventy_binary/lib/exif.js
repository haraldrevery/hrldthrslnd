/**
 * EXIF, read and scrubbed, without a dependency.
 *
 * Two jobs, both for JPEG files:
 *
 *   readExif()  the handful of tags this site can use — orientation, a
 *               description, the maker's name, dates — and whether the file
 *               carries a GPS block at all.
 *   stripGps()  a copy of the file with the GPS block emptied and any GPS
 *               values in an XMP packet blanked, and NOTHING ELSE touched.
 *
 * The scrub is in place, not a rewrite. A TIFF structure is a web of offsets,
 * and rebuilding it is how a metadata library silently drops the orientation
 * tag or the colour profile. Overwriting the GPS entries with zeros and
 * setting that directory's count to zero leaves every other offset exactly
 * where it was, so the file is byte-for-byte the same outside the block that
 * had to go. A reader that walks the (now empty) GPS directory finds nothing;
 * one that follows the pointer to it finds a valid, empty directory.
 *
 * Only JPEG is handled. A PNG can carry an eXIf chunk and a WebP an EXIF
 * chunk; both are rare from cameras and neither is scrubbed here — the import
 * pipeline says so when it sees one rather than pretending.
 *
 * Every read is bounds-checked and every failure is "no EXIF", because a
 * malformed header must never take an import down: the photograph is still a
 * photograph.
 */

const TAGS = {
  0x010e: "description",
  0x010f: "make",
  0x0110: "model",
  0x0112: "orientation",
  0x0132: "dateTime",
  0x013b: "artist",
  0x8298: "copyright",
  0x8769: "exifIfd",
  0x8825: "gpsIfd",
  0x9003: "dateTimeOriginal",
  0x9c9b: "xpTitle",
  0x9c9c: "xpComment",
  0x9c9d: "xpAuthor",
  0x9c9e: "xpKeywords",
  0x9c9f: "xpSubject",
};

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

const EXIF_HEADER = "Exif\0\0";
const XMP_HEADER = "http://ns.adobe.com/xap/1.0/\0";

/**
 * Every APP1 segment in a JPEG, with its payload offsets.
 * Stops at the first Start Of Scan: metadata never follows image data.
 */
function app1Segments(buffer) {
  const segments = [];
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return segments;

  let offset = 2;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) return segments;
    const marker = buffer[offset + 1];
    if (marker === 0xff) { offset += 1; continue; }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) { offset += 2; continue; }
    if (marker === 0xda) return segments; // SOS

    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) return segments;
    const start = offset + 4;
    const end = Math.min(offset + 2 + length, buffer.length);
    if (marker === 0xe1) segments.push({ start, end });
    offset += 2 + length;
  }
  return segments;
}

/** A little reader over one TIFF structure, endianness included. */
function tiffReader(buffer, base, end) {
  const order = buffer.toString("ascii", base, base + 2);
  if (order !== "II" && order !== "MM") return null;
  const le = order === "II";
  const u16 = (at) => (at + 2 <= end ? (le ? buffer.readUInt16LE(at) : buffer.readUInt16BE(at)) : null);
  const u32 = (at) => (at + 4 <= end ? (le ? buffer.readUInt32LE(at) : buffer.readUInt32BE(at)) : null);
  if (u16(base + 2) !== 0x2a) return null;
  const ifd0 = u32(base + 4);
  if (ifd0 == null) return null;
  return { le, u16, u32, base, end, ifd0: base + ifd0 };
}

/** The entries of one IFD: tag, type, count, and where the value bytes are. */
function readIfd(r, at) {
  const entries = [];
  const count = r.u16(at);
  if (count == null || count > 1000) return entries;
  for (let i = 0; i < count; i += 1) {
    const e = at + 2 + i * 12;
    if (e + 12 > r.end) break;
    const tag = r.u16(e);
    const type = r.u16(e + 2);
    const n = r.u32(e + 4);
    const size = (TYPE_SIZE[type] ?? 1) * n;
    const valueAt = size <= 4 ? e + 8 : r.base + r.u32(e + 8);
    entries.push({ entryAt: e, tag, type, count: n, size, valueAt, inline: size <= 4 });
  }
  return entries;
}

function readValue(buffer, r, entry) {
  const { type, count, valueAt, size } = entry;
  if (valueAt < r.base || valueAt + size > r.end) return null;
  if (type === 2) {
    return buffer.toString("utf8", valueAt, valueAt + count).replace(/\0+$/, "").trim();
  }
  if (type === 3) return r.u16(valueAt);
  if (type === 4) return r.u32(valueAt);
  if (type === 1 || type === 7) return buffer.subarray(valueAt, valueAt + size);
  return null;
}

/** Windows XP* tags are UCS-2 little-endian bytes of type UNDEFINED. */
function ucs2(bytes) {
  if (!bytes || bytes.length < 2) return "";
  const even = bytes.subarray(0, bytes.length - (bytes.length % 2));
  return Buffer.from(even).toString("utf16le").replace(/\0+$/, "").trim();
}

const EMPTY = { present: false, hasGps: false, xmpGps: false };

/**
 * @returns {{present:boolean, hasGps:boolean, xmpGps:boolean, orientation?:number,
 *   description?:string, artist?:string, copyright?:string, make?:string,
 *   model?:string, dateTime?:string, dateTimeOriginal?:string,
 *   xpTitle?:string, xpComment?:string, xpKeywords?:string}}
 */
export function readExif(buffer) {
  try {
    const result = { ...EMPTY };
    for (const segment of app1Segments(buffer)) {
      const header = buffer.toString("latin1", segment.start, segment.start + Math.min(32, segment.end - segment.start));
      if (header.startsWith(XMP_HEADER)) {
        const xmp = buffer.toString("utf8", segment.start + XMP_HEADER.length, segment.end);
        if (/exif:GPS/i.test(xmp)) result.xmpGps = true;
        continue;
      }
      if (!header.startsWith(EXIF_HEADER)) continue;

      const r = tiffReader(buffer, segment.start + EXIF_HEADER.length, segment.end);
      if (!r) continue;
      result.present = true;

      const visit = (at, depth) => {
        if (depth > 2) return;
        for (const entry of readIfd(r, at)) {
          const name = TAGS[entry.tag];
          if (!name) continue;
          if (name === "gpsIfd") {
            result.hasGps = true;
            continue;
          }
          if (name === "exifIfd") {
            const pointer = readValue(buffer, r, entry);
            if (typeof pointer === "number") visit(r.base + pointer, depth + 1);
            continue;
          }
          const value = readValue(buffer, r, entry);
          if (value == null) continue;
          if (name.startsWith("xp")) {
            const text = ucs2(value);
            if (text) result[name] = text;
          } else if (typeof value === "string") {
            if (value) result[name] = value;
          } else if (typeof value === "number") {
            result[name] = value;
          }
        }
      };
      visit(r.ifd0, 0);
    }
    return result;
  } catch {
    return { ...EMPTY };
  }
}

/**
 * A copy of the file with every GPS value removed.
 *
 * @returns {{buffer: Buffer, changed: boolean, removed: string[]}}
 */
export function stripGps(input) {
  const buffer = Buffer.from(input);
  const removed = [];
  try {
    for (const segment of app1Segments(buffer)) {
      const header = buffer.toString("latin1", segment.start, segment.start + Math.min(32, segment.end - segment.start));

      if (header.startsWith(XMP_HEADER)) {
        if (scrubXmp(buffer, segment.start + XMP_HEADER.length, segment.end)) removed.push("XMP GPS values");
        continue;
      }
      if (!header.startsWith(EXIF_HEADER)) continue;

      const r = tiffReader(buffer, segment.start + EXIF_HEADER.length, segment.end);
      if (!r) continue;

      for (const entry of readIfd(r, r.ifd0)) {
        if (entry.tag !== 0x8825) continue;
        const pointer = readValue(buffer, r, entry);
        if (typeof pointer !== "number") continue;
        const gpsAt = r.base + pointer;
        if (gpsAt + 2 > r.end) continue;

        // Zero every entry's value bytes, wherever they live, then the entries
        // themselves, then the count. Offsets elsewhere are untouched.
        for (const gps of readIfd(r, gpsAt)) {
          if (!gps.inline && gps.valueAt >= r.base && gps.valueAt + gps.size <= r.end) {
            buffer.fill(0, gps.valueAt, gps.valueAt + gps.size);
          }
          buffer.fill(0, gps.entryAt, gps.entryAt + 12);
        }
        if (r.le) buffer.writeUInt16LE(0, gpsAt);
        else buffer.writeUInt16BE(0, gpsAt);
        removed.push("EXIF GPS directory");
      }
    }
  } catch {
    // A malformed header is left exactly as it was; nothing was changed.
  }
  return { buffer, changed: removed.length > 0, removed };
}

/**
 * Blank GPS values inside an XMP packet, preserving its length so the segment
 * length and every offset after it stay valid. Attribute form
 * (exif:GPSLatitude="…") and element form (<exif:GPSLatitude>…</…>) both.
 */
function scrubXmp(buffer, start, end) {
  const text = buffer.toString("latin1", start, end);
  let changed = false;
  const blank = (match, ...groups) => {
    // Keep the name and the quotes or tags; blank only the value, same length.
    const [head, value, tail] = groups;
    changed = true;
    return head + " ".repeat(value.length) + tail;
  };
  let out = text.replace(/(exif:GPS[A-Za-z]*=")([^"]*)(")/g, blank);
  out = out.replace(/(<exif:GPS[A-Za-z]*>)([^<]*)(<\/exif:GPS[A-Za-z]*>)/g, blank);
  if (changed) buffer.write(out, start, "latin1");
  return changed;
}

export default readExif;
