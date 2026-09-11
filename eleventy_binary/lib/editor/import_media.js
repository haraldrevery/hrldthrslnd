/**
 * What happens to a file the moment it is dropped into the editor.
 *
 * A photograph is decoded, turned upright, capped at the site's own size
 * budget and 2800px, stripped of its GPS block, and given its _min
 * counterpart — the same encoder, the same settings and the same 80 kB
 * ceiling the build uses when it has to make one itself. Everything else is
 * checked and passed through: a video is not converted, only looked at, and
 * the editor is told what it saw.
 *
 * Returns files to write and things to say. It writes nothing: the store does
 * that, under its own rules.
 */
import { initCodecs, decodeJpeg, encodeJpeg, decodePng, resize } from "../codecs.js";
import { readExif, stripGps } from "../exif.js";
import { encodeThumbnail, encodeOriginal, orientImage, MAX_ORIGINAL_EDGE } from "../thumbnail.js";
import { extensionOf, isRaster, isDecodable, minFileName, VIDEO_EXT, AUDIO_EXT } from "../paths.js";

/** A file name the site and every filesystem are happy with. */
export function safeAssetName(original) {
  const base = String(original ?? "file").split(/[\\/]/).pop();
  const ext = extensionOf(base);
  const stem = (ext ? base.slice(0, -ext.length) : base)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "")
    .replace(/_{2,}/g, "_");
  return `${stem || "file"}${ext}`;
}

/** Longest-edge and byte cap for an original photograph, from the settings. */
function originalBudget(settings) {
  const declared = Number(settings?.status_check?.max_image_bytes) || 900_000;
  // page_builder_app.md asks for 250–750 kB; the site's own budget is the
  // ceiling and 750 kB the target, whichever is smaller.
  return Math.min(declared, 750_000);
}

async function decode(bytes, name) {
  const ext = extensionOf(name);
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  if (ext === ".jpg" || ext === ".jpeg") return decodeJpeg(ab);
  if (ext === ".png") return decodePng(ab);
  return null;
}

/**
 * @param {object} options
 * @param {string} options.name       the name the file arrived with
 * @param {Buffer} options.bytes
 * @param {object} options.settings   site settings, for the budgets
 * @returns {Promise<{files: {name:string, bytes:Buffer}[], primary: string,
 *   kind: string, notices: {level:string, message:string, detail?:string}[],
 *   suggested: {title?:string, alt?:string}, width?: number, height?: number}>}
 */
export async function importMedia({ name, bytes, settings }) {
  const safe = safeAssetName(name);
  const ext = extensionOf(safe);
  const notices = [];
  const limits = settings?.status_check ?? {};
  const say = (level, message, detail) => notices.push({ level, message, detail });

  if (isRaster(safe)) return importRaster({ safe, ext, bytes, settings, notices, say });

  if (ext === ".gif") {
    if (limits.max_gif_bytes && bytes.length > limits.max_gif_bytes) {
      say("warn", `the GIF is ${Math.round(bytes.length / 1000)} kB`, `over the ${Math.round(limits.max_gif_bytes / 1000)} kB budget; a short MP4 is usually a tenth of the size`);
    }
    return { files: [{ name: safe, bytes, role: "primary" }], primary: safe, kind: "image", notices, suggested: {} };
  }
  if (ext === ".svg") {
    if (/<script\b/i.test(bytes.toString("utf8", 0, Math.min(bytes.length, 200_000)))) say("warn", "the SVG contains a <script>", "it will not run when embedded as an image, but this site ships no scripts on purpose");
    return { files: [{ name: safe, bytes, role: "primary" }], primary: safe, kind: "image", notices, suggested: {} };
  }
  if (VIDEO_EXT.has(ext)) {
    checkVideo(bytes, ext, limits, say);
    return { files: [{ name: safe, bytes, role: "primary" }], primary: safe, kind: "video", notices, suggested: {} };
  }
  if (AUDIO_EXT.has(ext)) {
    if (limits.max_audio_bytes && bytes.length > limits.max_audio_bytes) say("warn", `the audio file is ${Math.round(bytes.length / 1_000_000)} MB`, "over the budget in site_settings.json");
    if (ext === ".wav" || ext === ".flac") say("note", `${ext} is uncompressed or lossless`, "fine for a download; for playback an .mp3 or .opus is a fraction of the size");
    return { files: [{ name: safe, bytes, role: "primary" }], primary: safe, kind: "audio", notices, suggested: {} };
  }

  say("note", "kept as a download", "not a picture, video or audio format the site knows how to display");
  return { files: [{ name: safe, bytes, role: "primary" }], primary: safe, kind: "file", notices, suggested: {} };
}

async function importRaster({ safe, ext, bytes, settings, notices, say }) {
  const suggested = {};
  const exif = ext === ".jpg" || ext === ".jpeg" ? readExif(bytes) : { present: false, hasGps: false, xmpGps: false };

  if (exif.present) {
    if (exif.xpTitle) suggested.title = exif.xpTitle;
    if (exif.description && exif.description !== exif.xpTitle) suggested.alt = exif.description;
    else if (exif.xpComment) suggested.alt = exif.xpComment;
    if (exif.dateTimeOriginal) suggested.date = exif.dateTimeOriginal.slice(0, 10).replace(/:/g, "-");
    if (exif.artist) suggested.author = exif.artist;
  }

  if (!isDecodable(safe)) {
    say("note", `no decoder for ${ext}`, "the file is kept as it is; no _min counterpart can be made, and its EXIF is not read");
    return { files: [{ name: safe, bytes, role: "primary" }], primary: safe, kind: "image", notices, suggested };
  }

  await initCodecs();
  let image;
  try {
    image = await decode(bytes, safe);
  } catch (error) {
    say("error", "the file could not be decoded", error.message);
    return { files: [], primary: null, kind: "image", notices, suggested };
  }

  const upright = orientImage(image, exif.orientation);
  const budget = originalBudget(settings);
  const longest = Math.max(upright.width, upright.height);
  const files = [];
  let primary = safe;
  let original = bytes;

  const tooBig = bytes.length > budget;
  const tooWide = longest > MAX_ORIGINAL_EDGE;
  if (tooBig || tooWide) {
    const encoded = await encodeOriginal(upright, { encodeJpeg, resize, maxBytes: budget });
    const stem = safe.slice(0, -ext.length);
    primary = `${stem}.jpg`;
    original = Buffer.from(encoded.bytes);
    say(
      "note",
      `re-encoded to ${encoded.width}×${encoded.height} at q${encoded.quality}, ${Math.round(original.length / 1000)} kB`,
      tooWide
        ? `the file was ${upright.width}×${upright.height}; originals are kept under ${MAX_ORIGINAL_EDGE}px and ${Math.round(budget / 1000)} kB`
        : `the file was ${Math.round(bytes.length / 1000)} kB; originals are kept under ${Math.round(budget / 1000)} kB`,
    );
    if (original.length > budget) say("warn", "still over the budget after re-encoding", "this picture resists compression; it ships as it is");
    if (exif.hasGps || exif.xmpGps) say("note", "location data removed", "the re-encoded file carries no EXIF at all");
    if (exif.present && !exif.hasGps) say("note", "EXIF dropped by the re-encode", "camera, date and description were read first and are offered as suggestions");
  } else if (exif.hasGps || exif.xmpGps) {
    const scrubbed = stripGps(bytes);
    original = scrubbed.buffer;
    say("note", "location data removed", scrubbed.removed.join(", ") + " — the rest of the file is untouched");
  } else if (exif.orientation && exif.orientation !== 1) {
    say("note", "the file is stored rotated", "browsers turn the original the right way up; the counterpart is made from upright pixels");
  }

  files.push({ name: primary, bytes: original, role: "primary" });

  const thumb = await encodeThumbnail(upright, { encodeJpeg, resize });
  if (thumb) {
    // Named from the primary by the caller once the primary's final name is
    // known — see freeName() in store.js for why the two cannot be renamed apart.
    files.push({ name: minFileName(primary), bytes: Buffer.from(thumb.bytes), role: "min" });
    if (thumb.bytes.byteLength > 80_000) say("warn", "the _min counterpart is over 80 kB", `${Math.round(thumb.bytes.byteLength / 1000)} kB at the smallest size tried`);
  }

  return { files, primary, kind: "image", notices, suggested, width: upright.width, height: upright.height };
}

/**
 * Not converted, only looked at. The container's brand says most of what a
 * browser will do with it, and an HEVC track inside an MP4 is the one thing
 * that looks fine and then plays nowhere but Safari.
 */
function checkVideo(bytes, ext, limits, say) {
  if (limits.max_video_bytes && bytes.length > limits.max_video_bytes) {
    say("warn", `the video is ${Math.round(bytes.length / 1_000_000)} MB`, "over the budget in site_settings.json");
  }
  if (ext === ".mov") say("warn", ".mov is QuickTime", "Chrome and Firefox will not reliably play it; export as .mp4 (H.264 video, AAC audio)");
  if (ext === ".ogv") say("note", ".ogv plays in Firefox and Chrome but not Safari", "an .mp4 or .webm reaches everyone");
  if (ext === ".mp4" || ext === ".m4v" || ext === ".mov") {
    const head = bytes.subarray(0, Math.min(bytes.length, 262_144)).toString("latin1");
    if (/hvc1|hev1/.test(head)) say("warn", "the video looks like HEVC (H.265)", "it will not play in most browsers; export as H.264");
    if (/av01/.test(head)) say("note", "the video looks like AV1", "recent browsers play it; older ones do not");
    if (bytes.length > 4_000_000) {
      const moovAt = head.indexOf("moov");
      const mdatAt = head.indexOf("mdat");
      if (moovAt < 0 && mdatAt >= 0) say("note", "the index is at the end of the file", "the browser must download all of it before it can start; remux with the moov atom first (\"fast start\")");
    }
  }
}

export default importMedia;
