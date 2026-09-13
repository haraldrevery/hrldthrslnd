/**
 * Photograph metadata, read and scrubbed, without a dependency.
 *
 * Four jobs, all for JPEG files:
 *
 *   readExif()     what this site can use from the three places a JPEG keeps
 *                  its metadata — the EXIF block, the XMP packet and the IPTC
 *                  record — and whether the file carries a GPS block at all.
 *   describedAs()  from that, the one title, caption, creator and rights line
 *                  a picture should be given, in the order the tools that
 *                  wrote them expect to be believed.
 *   stripGps()     a copy of the file with the GPS block emptied and any GPS
 *                  values in an XMP packet blanked, and NOTHING ELSE touched.
 *   embedXmp()     a freshly encoded JPEG with a minimal XMP packet put back:
 *                  the title, caption, creator and rights that re-encoding
 *                  would otherwise have thrown away. Nothing else — no camera
 *                  data, no develop settings, no location.
 *
 * Where a title lives depends on what wrote it. Lightroom, Capture One,
 * darktable and ExifTool write the title to XMP dc:title and IPTC ObjectName,
 * and the caption to XMP dc:description, IPTC Caption-Abstract and usually
 * EXIF ImageDescription. Windows Explorer writes its Title to XPTitle AND to
 * ImageDescription, and its Comments to XPComment. Cameras write
 * ImageDescription too, and what they write is "OLYMPUS DIGITAL CAMERA".
 * describedAs() is where all of that is untangled, once.
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
 * chunk; both are rare from cameras and neither is read here — the import
 * pipeline says so when it sees one rather than pretending.
 *
 * Every read is bounds-checked and every failure is "no metadata", because a
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
  0x9286: "userComment",
  0x9c9b: "xpTitle",
  0x9c9c: "xpComment",
  0x9c9d: "xpAuthor",
  0x9c9e: "xpKeywords",
  0x9c9f: "xpSubject",
};

/** IPTC-IIM record 2 datasets, by number. */
const IPTC_TAGS = { 5: "iptcTitle", 80: "iptcByline", 116: "iptcCopyright", 120: "iptcCaption" };

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

const EXIF_HEADER = "Exif\0\0";
const XMP_HEADER = "http://ns.adobe.com/xap/1.0/\0";
const PHOTOSHOP_HEADER = "Photoshop 3.0\0";

/**
 * Every APPn segment in a JPEG, with its marker and payload offsets.
 * Stops at the first Start Of Scan: metadata never follows image data.
 */
function appSegments(buffer) {
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
    if (marker >= 0xe0 && marker <= 0xef) segments.push({ marker, start, end });
    offset += 2 + length;
  }
  return segments;
}

const app1Segments = (buffer) => appSegments(buffer).filter((s) => s.marker === 0xe1);

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

/**
 * EXIF UserComment: an 8-byte character-code prefix, then the text. UNICODE
 * is UCS-2 in the file's own byte order; ASCII and the all-zero "undefined"
 * code are read as UTF-8, which is what writers put there in practice. JIS is
 * not worth a decoder here and reads as nothing.
 */
function userComment(bytes, le) {
  if (!bytes || bytes.length <= 8) return "";
  const code = bytes.toString("latin1", 0, 8).replace(/\0+$/, "");
  const body = bytes.subarray(8);
  if (code === "UNICODE") {
    const even = Buffer.from(body.subarray(0, body.length - (body.length % 2)));
    if (!le) even.swap16();
    return even.toString("utf16le").replace(/\0+$/, "").trim();
  }
  if (code === "ASCII" || code === "") return body.toString("utf8").replace(/\0+$/, "").trim();
  return "";
}

/* ------------------------------------------------------------------- XMP */

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** The text inside an XML fragment: tags dropped, entities decoded. */
function xmlText(fragment) {
  return String(fragment)
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, entity) => {
      if (entity[0] !== "#") return ENTITIES[entity.toLowerCase()];
      const code = entity[1] === "x" || entity[1] === "X" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    })
    .trim();
}

/**
 * One XMP property's value, by its qualified name.
 *
 * dc:title, dc:description and dc:rights are language alternatives — an
 * rdf:Alt of rdf:li, one per language — and the one to take is x-default,
 * or the first when no item says. dc:creator is an ordered list; its first
 * item is the author. A simple property can also be written as an attribute
 * on rdf:Description, which is how some writers do everything.
 *
 * A regular expression rather than an XML parser, deliberately: the packet is
 * machine-written, the four properties read here have fixed names, and a
 * packet this cannot read gives "no title" rather than an exception.
 */
function xmpProperty(xmp, name) {
  const element = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xmp);
  if (element) {
    const items = [...element[1].matchAll(/<rdf:li\b([^>]*)>([\s\S]*?)<\/rdf:li>/g)];
    if (!items.length) return xmlText(element[1]);
    const preferred = items.find(([, attributes]) => /xml:lang\s*=\s*["']x-default["']/i.test(attributes)) ?? items[0];
    return xmlText(preferred[2]);
  }
  const attribute = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(xmp);
  return attribute ? xmlText(attribute[1] ?? attribute[2]) : "";
}

/* ------------------------------------------------------------------ IPTC */

/**
 * The IPTC record inside a Photoshop APP13 segment: a run of 8BIM resource
 * blocks, of which 0x0404 is IPTC-IIM. Each dataset is 0x1C, record,
 * dataset, a two-byte length (or, with the top bit set, the width of an
 * extended length that follows), then the bytes.
 *
 * Dataset 1:90 declares the character set; ESC % G is UTF-8. Undeclared text
 * is read as UTF-8 when it decodes cleanly — most modern writers use it
 * without saying so — and as Latin-1 when it does not.
 */
function readIptc(buffer, start, end, result) {
  let at = start + PHOTOSHOP_HEADER.length;
  while (at + 12 <= end && buffer.toString("latin1", at, at + 4) === "8BIM") {
    const id = buffer.readUInt16BE(at + 4);
    const nameLength = buffer[at + 6];
    const sizeAt = at + 7 + nameLength + ((1 + nameLength) % 2);
    if (sizeAt + 4 > end) return;
    const size = buffer.readUInt32BE(sizeAt);
    const dataAt = sizeAt + 4;
    if (id === 0x0404) readIptcRecords(buffer, dataAt, Math.min(dataAt + size, end), result);
    at = dataAt + size + (size % 2);
  }
}

function readIptcRecords(buffer, start, end, result) {
  const raw = {};
  let utf8 = false;
  let at = start;
  while (at + 5 <= end && buffer[at] === 0x1c) {
    const record = buffer[at + 1];
    const dataset = buffer[at + 2];
    let length = buffer.readUInt16BE(at + 3);
    let dataAt = at + 5;
    if (length & 0x8000) {
      const width = length & 0x7fff;
      if (width < 1 || width > 4 || dataAt + width > end) return;
      length = buffer.readUIntBE(dataAt, width);
      dataAt += width;
    }
    if (dataAt + length > end) return;
    const bytes = buffer.subarray(dataAt, dataAt + length);
    if (record === 1 && dataset === 90) utf8 = bytes.equals(Buffer.from([0x1b, 0x25, 0x47]));
    const name = record === 2 ? IPTC_TAGS[dataset] : undefined;
    if (name && raw[name] === undefined) raw[name] = bytes; // a repeated dataset: the first one
    at = dataAt + length;
  }
  for (const [name, bytes] of Object.entries(raw)) {
    const asUtf8 = bytes.toString("utf8");
    const text = (utf8 || !asUtf8.includes("�") ? asUtf8 : bytes.toString("latin1")).replace(/\0+$/, "").trim();
    if (text && result[name] === undefined) result[name] = text;
  }
}

/* ------------------------------------------------------------------ read */

const EMPTY = { present: false, hasGps: false, xmpGps: false };

/**
 * @returns {{present:boolean, hasGps:boolean, xmpGps:boolean, orientation?:number,
 *   description?:string, artist?:string, copyright?:string, make?:string,
 *   model?:string, dateTime?:string, dateTimeOriginal?:string, userComment?:string,
 *   xpTitle?:string, xpComment?:string, xpAuthor?:string, xpKeywords?:string, xpSubject?:string,
 *   xmpTitle?:string, xmpDescription?:string, xmpCreator?:string, xmpRights?:string,
 *   iptcTitle?:string, iptcCaption?:string, iptcByline?:string, iptcCopyright?:string}}
 *
 * `present` means a file carries metadata of any of the three kinds.
 */
export function readExif(buffer) {
  try {
    const result = { ...EMPTY };
    for (const segment of appSegments(buffer)) {
      const header = buffer.toString("latin1", segment.start, segment.start + Math.min(32, segment.end - segment.start));

      if (segment.marker === 0xed) {
        if (header.startsWith(PHOTOSHOP_HEADER)) {
          const before = Object.keys(result).length;
          readIptc(buffer, segment.start, segment.end, result);
          if (Object.keys(result).length > before) result.present = true;
        }
        continue;
      }
      if (segment.marker !== 0xe1) continue;

      if (header.startsWith(XMP_HEADER)) {
        const xmp = buffer.toString("utf8", segment.start + XMP_HEADER.length, segment.end);
        if (/exif:GPS/i.test(xmp)) result.xmpGps = true;
        const props = { xmpTitle: "dc:title", xmpDescription: "dc:description", xmpCreator: "dc:creator", xmpRights: "dc:rights" };
        for (const [key, name] of Object.entries(props)) {
          const value = xmpProperty(xmp, name);
          if (value && result[key] === undefined) { result[key] = value; result.present = true; }
        }
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
          if (name === "userComment") {
            const text = userComment(value, r.le);
            if (text) result.userComment = text;
          } else if (name.startsWith("xp")) {
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
 * What a camera writes when nobody has written anything. Matched against the
 * whole value, so a real caption that happens to start with "Image" survives.
 */
const BOILERPLATE = /^(?:olympus digital camera|sony dsc|digital camera|kodak digital still camera|minolta digital camera|samsung digital camera|lg digital camera|digital still camera|default|untitled|image|picture|photo|dcim\b.*|created with .+|lead technologies.+)$/i;

function meaningful(value) {
  const text = String(value ?? "").replace(/[\0-\x1f\x7f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!text || BOILERPLATE.test(text) || /^[\s.?_*-]+$/.test(text)) return "";
  return text;
}

/**
 * The title, caption, creator and rights a picture should be given, from what
 * readExif() found.
 *
 * XMP first, IPTC second, EXIF last: the order the Metadata Working Group
 * guidance gives, and the order in which a Lightroom or ExifTool edit reaches
 * them. A caption that only repeats the title is not a caption — Windows puts
 * its Title in ImageDescription as well — so the first candidate that says
 * something different is taken, or none.
 *
 * @returns {{title:string, caption:string, creator:string, rights:string}}
 */
export function describedAs(exif) {
  const first = (...values) => values.map(meaningful).find(Boolean) || "";
  const title = first(exif?.xmpTitle, exif?.iptcTitle, exif?.xpTitle);
  const caption = [exif?.xmpDescription, exif?.iptcCaption, exif?.description, exif?.xpComment, exif?.xpSubject, exif?.userComment]
    .map(meaningful)
    .find((value) => value && value !== title) || "";
  return {
    title,
    caption,
    creator: first(exif?.xmpCreator, exif?.iptcByline, exif?.artist, exif?.xpAuthor),
    rights: first(exif?.xmpRights, exif?.iptcCopyright, exif?.copyright),
  };
}

/* --------------------------------------------------------------- scrub */

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

/* ---------------------------------------------------------------- embed */

const xmlEscape = (value) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * A JPEG with a minimal XMP packet inserted: dc:title, dc:description,
 * dc:creator and dc:rights, whichever are given. For a file this pipeline has
 * just encoded, which carries no metadata of its own — so there is nothing to
 * merge with and nothing to scrub.
 *
 * The segment goes after SOI and the JFIF APP0 when there is one, where every
 * reader looks for it. A packet too long for one segment (64 kB) is not
 * written at all rather than split: four short strings never come near it.
 *
 * @returns {Buffer} the new file, or the input unchanged when there was
 *   nothing to write or it is not a JPEG
 */
export function embedXmp(input, { title = "", caption = "", creator = "", rights = "" } = {}) {
  const buffer = Buffer.from(input);
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return buffer;

  const alt = (name, value) => `   <dc:${name}><rdf:Alt><rdf:li xml:lang="x-default">${xmlEscape(value)}</rdf:li></rdf:Alt></dc:${name}>\n`;
  let props = "";
  if (meaningful(title)) props += alt("title", meaningful(title));
  if (meaningful(caption)) props += alt("description", meaningful(caption));
  if (meaningful(creator)) props += `   <dc:creator><rdf:Seq><rdf:li>${xmlEscape(meaningful(creator))}</rdf:li></rdf:Seq></dc:creator>\n`;
  if (meaningful(rights)) props += alt("rights", meaningful(rights));
  if (!props) return buffer;

  const packet =
    `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>\n` +
    `<x:xmpmeta xmlns:x="adobe:ns:meta/">\n` +
    ` <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n` +
    `  <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">\n` +
    props +
    `  </rdf:Description>\n` +
    ` </rdf:RDF>\n` +
    `</x:xmpmeta>\n` +
    `<?xpacket end="w"?>`;
  const payload = Buffer.concat([Buffer.from(XMP_HEADER, "latin1"), Buffer.from(packet, "utf8")]);
  if (payload.length + 2 > 0xffff) return buffer;

  let at = 2;
  if (buffer[2] === 0xff && buffer[3] === 0xe0 && buffer.length >= 6) at = 4 + buffer.readUInt16BE(4);
  if (at > buffer.length) return buffer;
  const head = Buffer.from([0xff, 0xe1, 0, 0]);
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([buffer.subarray(0, at), head, payload, buffer.subarray(at)]);
}

export default readExif;
