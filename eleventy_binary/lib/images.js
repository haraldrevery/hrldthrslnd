/**
 * The image_min mirror.
 *
 * `image_min/` holds a compressed counterpart for every file in `image/`, with
 * subfolders mirrored. Galleries and post thumbnails load the counterpart, so a
 * page never pulls a full-resolution photo just to show a thumbnail.
 *
 * A counterpart the author maintains by hand is left completely alone. Only
 * missing ones are generated, and every generated file is reported — per
 * website.md, the author must be told the builder had to step in.
 */
import fs from "node:fs";
import path from "node:path";

import log from "./log.js";
import { initCodecs, decodeJpeg, encodeJpeg, decodePng, resize } from "./codecs.js";
import { isRaster, isDecodable, isMinName, minFileName, extensionOf } from "./paths.js";
import { readImageHeader } from "./imagesize.js";
import { walkFiles } from "./slugs.js";

/**
 * Edge ladder. A thumbnail never needs more than the first value; the smaller
 * ones are fallbacks for images that will not fit the byte budget at full size.
 * 1280 matches the hand-made counterparts already in this repository.
 */
const EDGE_STEPS = [1600, 1280, 1024, 800];
/** Hard ceiling from page_builder_app.md: no thumbnail over 80 kB. */
const MAX_BYTES = 80_000;
/** Quality ladder, walked down at each edge size. */
const QUALITY_STEPS = [72, 62, 54, 46, 38];
/**
 * How much newer a source has to be before its counterpart is worth mentioning.
 *
 * A fresh clone writes every file at about the same moment and in no
 * particular order, so an exact comparison reports half the tree as stale on
 * every new machine — which is the sort of permanent false positive that
 * teaches you to stop reading the report.
 */
const STALE_TOLERANCE_MS = 2000;
/** How far two aspect ratios may differ and still be the same picture. */
const ASPECT_TOLERANCE = 0.01;

/**
 * Whether an existing counterpart looks out of date, and how sure we are.
 *
 * Two signals, because neither is enough on its own. A counterpart whose
 * aspect ratio no longer matches its source cannot be a scaled copy of it —
 * that is proof the photograph was replaced. mtime catches the rest, including
 * a replacement of the same shape, but it also fires on a file that was merely
 * restored or touched, so it is reported as a question rather than a verdict.
 *
 * Returns null when there is nothing to say.
 */
function staleness(sourcePath, targetPath, targetMtimeMs) {
  const source = readImageHeader(sourcePath);
  const target = readImageHeader(targetPath);

  if (source && target && source.height > 0 && target.height > 0) {
    const sourceRatio = source.width / source.height;
    const targetRatio = target.width / target.height;
    if (Math.abs(sourceRatio - targetRatio) / sourceRatio > ASPECT_TOLERANCE) {
      return {
        certain: true,
        message: "counterpart is a different shape from the image it was made from",
        detail:
          `${target.width}×${target.height} against a ${source.width}×${source.height} ` +
          "source — cards, galleries and the social card are showing the previous " +
          "picture; delete the counterpart to have a fresh one generated",
      };
    }
  }

  let sourceMtimeMs = 0;
  try {
    sourceMtimeMs = fs.statSync(sourcePath).mtimeMs;
  } catch {
    return null; // an unreadable source is Eleventy's to report, not this pass's
  }

  if (sourceMtimeMs > targetMtimeMs + STALE_TOLERANCE_MS) {
    return {
      certain: false,
      message: "source is newer than its counterpart, though the shape still matches",
      detail:
        "harmless if the file was only restored or re-saved; if you replaced the " +
        "picture, delete the counterpart to have a fresh one generated",
    };
  }

  return null;
}

async function decodeAny(buffer, file) {
  // Guarded by the shared list rather than by the branches below, so the set of
  // formats this claims to handle and the set the status check expects a
  // counterpart for cannot drift apart again.
  if (!isDecodable(file)) return null;

  const ext = extensionOf(file);
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  );
  if (ext === ".jpg" || ext === ".jpeg") return decodeJpeg(arrayBuffer);
  if (ext === ".png") return decodePng(arrayBuffer);
  return null;
}

async function scaleToEdge(image, edge) {
  const longest = Math.max(image.width, image.height);
  if (longest <= edge) return image;
  const factor = edge / longest;
  return resize(image, {
    width: Math.max(1, Math.round(image.width * factor)),
    height: Math.max(1, Math.round(image.height * factor)),
  });
}

/**
 * Encode one thumbnail inside the 80 kB budget.
 *
 * Walks quality down at each size, then drops to the next size if quality alone
 * cannot get there. A detailed photograph will not reach 80 kB at 1600px no
 * matter how far the quality falls, and shipping an oversized thumbnail defeats
 * the point of having one — so dimensions give way before the budget does.
 *
 * Returns the smallest attempt if even the last combination overshoots, and
 * reports what it settled on so the caller can say so.
 */
async function encodeThumbnail(image) {
  const options = {
    // MozJpeg settings from page_builder_app.md.
    color_space: 3,        // YCbCr
    chroma_subsample: 2,   // auto 4:2:0
    smoothing: 30,
    quant_table: 3,        // ImageMagick table
    progressive: true,
    optimize_coding: true,
  };

  let smallest = null;
  let lastLongestEdge = null;

  for (const edge of EDGE_STEPS) {
    const source = await scaleToEdge(image, edge);
    const longest = Math.max(source.width, source.height);

    // scaleToEdge never enlarges, so every ladder step at or above the source's
    // own size yields the same pixels. Re-encoding those is pure waste: an
    // image 1280px on its longest edge used to walk the entire quality ladder
    // twice, once for the 1600 step and again for the identical 1280 one.
    if (longest === lastLongestEdge) continue;
    lastLongestEdge = longest;

    for (const quality of QUALITY_STEPS) {
      const encoded = await encodeJpeg(source, { ...options, quality });
      const attempt = {
        bytes: encoded,
        quality,
        width: source.width,
        height: source.height,
      };
      if (!smallest || encoded.byteLength < smallest.bytes.byteLength) smallest = attempt;
      if (encoded.byteLength <= MAX_BYTES) return attempt;
    }
  }

  return smallest;
}

/**
 * Ensure every raster file under `sourceDir` has a `_min` counterpart in
 * `targetDir`. Returns a report the status page can render.
 */
export async function mirrorDirectory(sourceDir, targetDir, { label, sourceLabel } = {}) {
  const report = { generated: [], skipped: [], oversized: [], stale: [], collisions: [], existing: 0 };
  if (!fs.existsSync(sourceDir)) return report;

  // The same walk the asset copier uses, so the two passes see exactly the same
  // files. They did not have to agree while this only ever looked at image/ and
  // a post folder; now that a photograph can sit beside a note in a symlinked
  // vault, a walk that skipped links here and followed them there would generate
  // no counterpart for a file that then shipped at full resolution.
  const files = walkFiles(sourceDir).filter((file) => !isMinName(file));
  if (files.length === 0) return report;

  // Two names, because for the site-wide mirror the source and the target are
  // different folders: a file in image/ gets its counterpart in image_min/, and
  // naming the source after the target reported image/photo.webp as living in
  // image_min/. Everywhere else the counterpart sits beside its source and the
  // two labels are the same.
  const from = sourceLabel ?? label ?? sourceDir;

  let codecsReady = false;

  /**
   * Counterpart path -> the image that claimed it.
   *
   * minFileName() answers "a_min.jpg" for a.jpg, a.png AND a.webp, because the
   * counterpart is always a JPEG. Two images sharing a basename therefore want
   * one file, and nothing used to notice: the first was generated, the second
   * found it already on disk, counted it as "existing" and moved on. Every
   * card, gallery cell and og:image for the second image then showed the first
   * image's photograph.
   *
   * The shape check in staleness() catches this only when the two happen to
   * differ in aspect ratio, and when it does it gives the wrong instruction —
   * deleting the counterpart just regenerates it from whichever file the walk
   * reaches first, so the author is sent round a loop. Two pictures cannot
   * share one thumbnail, so this is reported rather than resolved: renaming one
   * of them is a decision about URLs, and the build does not get to make it.
   */
  const claimedBy = new Map();

  for (const relative of files) {
    if (!isRaster(relative)) continue;

    const targetRelative = path.join(path.dirname(relative), minFileName(path.basename(relative)));
    const targetPath = path.join(targetDir, targetRelative);

    const sourcePath = path.join(sourceDir, relative);

    // Named by the folder the author knows, never by an absolute path: the
    // status page is published and linked from the site footer.
    const shownTarget = path.posix.join(label ?? "", targetRelative.split(path.sep).join("/"));

    const claimant = claimedBy.get(targetPath);
    if (claimant) {
      report.collisions.push({ target: shownTarget, first: claimant, second: relative });
      log.error(
        "images",
        "two images want the same _min counterpart",
        `${claimant} and ${relative} both reduce to ${shownTarget} — ` +
          "they differ only in extension; rename one, or the second will keep " +
          "showing the first one's thumbnail everywhere a thumbnail is used",
      );
      continue;
    }
    claimedBy.set(targetPath, relative);

    if (fs.existsSync(targetPath)) {
      report.existing += 1;
      const target = fs.statSync(targetPath);
      if (target.size > MAX_BYTES) {
        report.oversized.push({ file: path.join(targetDir, targetRelative), size: target.size });
      }

      // A counterpart older than the image it was made from is stale: the
      // photograph was replaced and the thumbnail was not. Everything that
      // shows a thumbnail — cards, gallery cells, the Open Graph image — then
      // goes on showing the OLD picture while the lightbox opens the new one,
      // and the baked width/height and --ar are wrong too if the shape changed.
      //
      // Reported rather than regenerated, on purpose. A counterpart the author
      // compressed by hand is theirs, and this pass promises at the top of the
      // file to leave it completely alone; silently re-encoding it the moment
      // someone touched the source would break that promise in the direction
      // that loses work. Deleting the _min file is how you ask for a new one.
      // Named the way the rest of the report names things — by the folder the
      // author knows it as, not by its absolute path. status_check.html is a
      // published page linked from the site footer, so an absolute path here
      // would put the build machine's directory layout on the web.
      const stale = staleness(sourcePath, targetPath, target.mtimeMs);
      if (stale) {
        report.stale.push({ file: shownTarget, ...stale });
        // Certain and merely suspected are reported at different volumes on
        // purpose. mtime alone is a weak signal: `git checkout` and `git stash
        // pop` both rewrite a file's timestamp without changing a pixel, so
        // warning on that would tell an author to delete a counterpart they
        // had compressed by hand, over a change that never happened. A shape
        // that no longer matches is proof, and only proof gets a warning.
        log[stale.certain ? "warn" : "note"]("images", stale.message, `${shownTarget} — ${stale.detail}`);
      }
      continue;
    }

    if (!codecsReady) {
      await initCodecs();
      codecsReady = true;
    }

    try {
      const image = await decodeAny(fs.readFileSync(sourcePath), relative);
      if (!image) {
        report.skipped.push(sourcePath);
        // A note, not a warning. This is not a fault in the file — the format
        // is simply one the mirror cannot encode from — and the status check
        // raises the visible finding for anything under image/. Warning in both
        // places reported one missing thumbnail as two problems.
        log.note(
          "images",
          "no decoder for this format, cannot generate a _min counterpart",
          `${from}/${relative} — add ${targetRelative} by hand ` +
            "if you want a thumbnail; the full-resolution file ships otherwise",
        );
        continue;
      }

      const encoded = await encodeThumbnail(image);
      if (!encoded) throw new Error("the encoder produced no output at any size or quality");

      const { bytes, quality, width, height } = encoded;
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, Buffer.from(bytes));

      const kb = Math.round(bytes.byteLength / 1024);
      report.generated.push({
        file: targetPath,
        bytes: bytes.byteLength,
        quality,
        width,
        height,
      });

      log.warn(
        "images",
        "missing counterpart generated",
        `${targetPath} (${width}×${height}, ${kb} kB at q${quality}) — ` +
          `maintain it yourself in ${label ?? targetDir}/ to control the compression`,
      );

      if (bytes.byteLength > MAX_BYTES) {
        log.warn(
          "images",
          "generated counterpart is still over the 80 kB budget",
          `${targetPath} at ${kb} kB — this image resists compression; ` +
            "supply a smaller counterpart by hand",
        );
      }
    } catch (error) {
      report.skipped.push(sourcePath);
      log.error("images", `could not generate a counterpart for ${sourcePath}`, error.message);
    }
  }

  return report;
}

/**
 * Run the mirror across every place a _min counterpart is expected:
 * the site-wide image/ tree, and each post folder's own assets.
 */
export async function generateMissingThumbnails(root = process.cwd()) {
  const reports = [];

  reports.push({
    scope: "image_min",
    ...(await mirrorDirectory(path.join(root, "image"), path.join(root, "image_min"), {
      label: "image_min",
      sourceLabel: "image",
    })),
  });

  // Pictures kept beside a note or a hand-written page, mirrored in place the
  // same way a post folder's are: there is no separate _min tree for these, the
  // counterpart sits next to the file it was made from and is copied to the
  // site alongside it.
  for (const source of ["input_markdown", "input_custom_html"]) {
    const dir = path.join(root, source);
    if (!fs.existsSync(dir)) continue;
    reports.push({
      scope: source,
      ...(await mirrorDirectory(dir, dir, { label: source })),
    });
  }

  const postsDir = path.join(root, "input_custom_post");
  if (fs.existsSync(postsDir)) {
    // Plain code-unit order, not localeCompare: the build must enumerate post
    // folders identically on every machine.
    for (const entry of fs.readdirSync(postsDir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      const folder = path.join(postsDir, name);
      // Post assets keep their counterpart beside them rather than in a mirror.
      reports.push({
        scope: `input_custom_post/${name}`,
        ...(await mirrorDirectory(folder, folder, { label: name })),
      });
    }
  }

  const totals = reports.reduce(
    (acc, r) => ({
      generated: acc.generated + r.generated.length,
      existing: acc.existing + r.existing,
      skipped: acc.skipped + r.skipped.length,
      oversized: acc.oversized + r.oversized.length,
      stale: acc.stale + (r.stale?.length ?? 0),
      collisions: acc.collisions + (r.collisions?.length ?? 0),
    }),
    { generated: 0, existing: 0, skipped: 0, oversized: 0, stale: 0, collisions: 0 },
  );

  if (totals.generated > 0) {
    log.info(
      `  generated ${totals.generated} missing _min file(s); ${totals.existing} already present`,
    );
  }

  return { reports, totals };
}

export default generateMissingThumbnails;
