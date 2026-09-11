/**
 * Encoding pictures: the thumbnail ladder, the original-size cap, and EXIF
 * orientation applied to pixels.
 *
 * Pure functions over an image and a pair of codec functions. The codecs are
 * passed in rather than imported because codecs.js is Bun-specific — it embeds
 * the WASM with a file import the binary understands — and this module has to
 * serve two callers: the build's mirror (images.js) and the editor's import
 * (editor/import_media.js). Both hand over the same @jsquash functions; the
 * arrangement just keeps this file free of anything that is not arithmetic.
 *
 * An "image" throughout is what @jsquash returns from a decode and accepts for
 * an encode: `{ data: Uint8ClampedArray (RGBA), width, height }`.
 */

/**
 * Edge ladder. A thumbnail never needs more than the first value; the smaller
 * ones are fallbacks for images that will not fit the byte budget at full size.
 * 1280 matches the hand-made counterparts already in this repository.
 */
export const EDGE_STEPS = [1600, 1280, 1024, 800];
/** Hard ceiling from page_builder_app.md: no thumbnail over 80 kB. */
export const MAX_THUMBNAIL_BYTES = 80_000;
/** Quality ladder, walked down at each edge size. */
export const QUALITY_STEPS = [72, 62, 54, 46, 38];

/** The longest edge an ORIGINAL keeps, from page_builder_app.md. */
export const MAX_ORIGINAL_EDGE = 2800;
/** Quality ladder for a re-encoded original: high, stepping down to fit. */
export const ORIGINAL_QUALITY_STEPS = [88, 84, 80, 76, 72, 68, 64, 60];

/** MozJPEG settings from page_builder_app.md, shared by both encoders. */
export const MOZJPEG_OPTIONS = {
  color_space: 3, // YCbCr
  chroma_subsample: 2, // auto 4:2:0
  smoothing: 30,
  quant_table: 3, // ImageMagick table
  progressive: true,
  optimize_coding: true,
};

/** Build an image object, using the platform's ImageData where there is one. */
export function makeImage(data, width, height) {
  if (typeof ImageData !== "undefined") {
    try {
      return new ImageData(data, width, height);
    } catch {
      /* fall through to the plain object */
    }
  }
  return { data, width, height };
}

/**
 * Apply an EXIF orientation to the pixels, so a picture that a camera stored
 * on its side comes out upright — and stays upright when the tag is gone.
 *
 * Browsers honour the tag on the ORIGINAL (`image-orientation: from-image` is
 * the default now), but a thumbnail encoded from the raw pixels carries no tag
 * and was shipping rotated: every card and gallery cell for a phone photograph
 * lay on its side while the lightbox opened it the right way up. Applying the
 * rotation here is what makes the counterpart match.
 *
 * The eight EXIF values, per the TIFF specification:
 *   1 as stored          2 mirrored horizontally
 *   3 rotated 180        4 mirrored vertically
 *   5 transposed         6 rotated 90 clockwise
 *   7 transversed        8 rotated 90 anticlockwise
 */
export function orientImage(image, orientation) {
  const o = Number(orientation);
  if (!(o >= 2 && o <= 8)) return image;

  const { width: w, height: h, data } = image;
  const swap = o >= 5; // the four transposing orientations swap the axes
  const ow = swap ? h : w;
  const oh = swap ? w : h;
  const out = new Uint8ClampedArray(ow * oh * 4);

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let tx;
      let ty;
      switch (o) {
        case 2: tx = w - 1 - x; ty = y; break;
        case 3: tx = w - 1 - x; ty = h - 1 - y; break;
        case 4: tx = x; ty = h - 1 - y; break;
        case 5: tx = y; ty = x; break;
        case 6: tx = h - 1 - y; ty = x; break;
        case 7: tx = h - 1 - y; ty = w - 1 - x; break;
        case 8: tx = y; ty = w - 1 - x; break;
        default: tx = x; ty = y;
      }
      const from = (y * w + x) * 4;
      const to = (ty * ow + tx) * 4;
      out[to] = data[from];
      out[to + 1] = data[from + 1];
      out[to + 2] = data[from + 2];
      out[to + 3] = data[from + 3];
    }
  }
  return makeImage(out, ow, oh);
}

/** Scale so the longest edge is at most `edge`; never enlarge. */
export async function scaleToEdge(image, edge, resize) {
  const longest = Math.max(image.width, image.height);
  if (longest <= edge) return image;
  const factor = edge / longest;
  return resize(image, {
    width: Math.max(1, Math.round(image.width * factor)),
    height: Math.max(1, Math.round(image.height * factor)),
  });
}

/**
 * Encode one thumbnail inside the byte budget.
 *
 * Walks quality down at each size, then drops to the next size if quality alone
 * cannot get there. A detailed photograph will not reach 80 kB at 1600px no
 * matter how far the quality falls, and shipping an oversized thumbnail defeats
 * the point of having one — so dimensions give way before the budget does.
 *
 * Returns the smallest attempt if even the last combination overshoots, and
 * reports what it settled on so the caller can say so.
 *
 * @param {object} image
 * @param {{encodeJpeg: Function, resize: Function, maxBytes?: number}} codecs
 */
export async function encodeThumbnail(image, { encodeJpeg, resize, maxBytes = MAX_THUMBNAIL_BYTES }) {
  return encodeLadder(image, {
    encodeJpeg,
    resize,
    maxBytes,
    edges: EDGE_STEPS,
    qualities: QUALITY_STEPS,
  });
}

/**
 * Re-encode an original that is too large: at most MAX_ORIGINAL_EDGE on its
 * longest side, and under the byte budget the site declares for a photograph,
 * at the highest quality that gets there. The whole quality ladder is walked
 * at the capped size before the size is reduced further, because an original
 * is what the lightbox opens and its resolution is what a reader zooms into.
 */
export async function encodeOriginal(image, { encodeJpeg, resize, maxBytes, maxEdge = MAX_ORIGINAL_EDGE }) {
  const edges = [maxEdge];
  for (let edge = maxEdge; edge > 1200; edge = Math.round(edge * 0.85)) edges.push(Math.round(edge * 0.85));
  return encodeLadder(image, { encodeJpeg, resize, maxBytes, edges, qualities: ORIGINAL_QUALITY_STEPS });
}

async function encodeLadder(image, { encodeJpeg, resize, maxBytes, edges, qualities }) {
  let smallest = null;
  let lastLongestEdge = null;

  for (const edge of edges) {
    const source = await scaleToEdge(image, edge, resize);
    const longest = Math.max(source.width, source.height);

    // scaleToEdge never enlarges, so every ladder step at or above the source's
    // own size yields the same pixels. Re-encoding those is pure waste.
    if (longest === lastLongestEdge) continue;
    lastLongestEdge = longest;

    for (const quality of qualities) {
      const encoded = await encodeJpeg(source, { ...MOZJPEG_OPTIONS, quality });
      const attempt = { bytes: encoded, quality, width: source.width, height: source.height };
      if (!smallest || encoded.byteLength < smallest.bytes.byteLength) smallest = attempt;
      if (encoded.byteLength <= maxBytes) return attempt;
    }
  }

  return smallest;
}
