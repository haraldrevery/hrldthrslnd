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
import { isRaster, isMinName, minFileName } from "./paths.js";

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

function walk(dir, base = dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, out);
    else if (entry.isFile()) out.push(path.relative(base, full));
  }
  return out;
}

async function decodeAny(buffer, file) {
  const ext = path.extname(file).toLowerCase();
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
export async function mirrorDirectory(sourceDir, targetDir, { label } = {}) {
  const report = { generated: [], skipped: [], oversized: [], existing: 0 };
  if (!fs.existsSync(sourceDir)) return report;

  const files = walk(sourceDir).filter((file) => !isMinName(file));
  if (files.length === 0) return report;

  let codecsReady = false;

  for (const relative of files) {
    if (!isRaster(relative)) continue;

    const targetRelative = path.join(path.dirname(relative), minFileName(path.basename(relative)));
    const targetPath = path.join(targetDir, targetRelative);

    if (fs.existsSync(targetPath)) {
      report.existing += 1;
      const size = fs.statSync(targetPath).size;
      if (size > MAX_BYTES) {
        report.oversized.push({ file: path.join(targetDir, targetRelative), size });
      }
      continue;
    }

    if (!codecsReady) {
      await initCodecs();
      codecsReady = true;
    }

    const sourcePath = path.join(sourceDir, relative);
    try {
      const image = await decodeAny(fs.readFileSync(sourcePath), relative);
      if (!image) {
        report.skipped.push(sourcePath);
        log.warn(
          "images",
          "no decoder for this format, cannot generate a _min counterpart",
          `${sourcePath} — add ${targetRelative} by hand`,
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
    })),
  });

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
    }),
    { generated: 0, existing: 0, skipped: 0, oversized: 0 },
  );

  if (totals.generated > 0) {
    log.info(
      `  generated ${totals.generated} missing _min file(s); ${totals.existing} already present`,
    );
  }

  return { reports, totals };
}

export default generateMissingThumbnails;
