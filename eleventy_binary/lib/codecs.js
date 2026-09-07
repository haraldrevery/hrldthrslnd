/**
 * WASM codec bootstrap.
 *
 * The compiled site_generate binary has no node_modules to load .wasm files
 * from at runtime, so every codec module is embedded with `type: "file"` and
 * handed to its init() as an already-compiled WebAssembly.Module. This is what
 * lets image generation work from a single self-contained binary.
 */
import decodeJpeg, { init as initJpegDecode } from "@jsquash/jpeg/decode.js";
import encodeJpeg, { init as initJpegEncode } from "@jsquash/jpeg/encode.js";
import decodePng, { init as initPngDecode } from "@jsquash/png/decode.js";
import resize, { initResize } from "@jsquash/resize";

import jpegDecWasm from "@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm" with { type: "file" };
import jpegEncWasm from "@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm" with { type: "file" };
import pngWasm from "@jsquash/png/codec/pkg/squoosh_png_bg.wasm" with { type: "file" };
import resizeWasm from "@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm" with { type: "file" };

import fs from "node:fs";

let ready = null;

async function compile(filePath) {
  // Bun exposes embedded files through the filesystem API; plain Node reads
  // them straight off disk. Both paths end at a compiled WebAssembly.Module.
  const bytes =
    typeof Bun !== "undefined"
      ? await Bun.file(filePath).arrayBuffer()
      : fs.readFileSync(filePath).buffer;
  return WebAssembly.compile(bytes);
}

export async function initCodecs() {
  if (ready) return ready;
  ready = (async () => {
    await initJpegDecode(await compile(jpegDecWasm));
    await initJpegEncode(await compile(jpegEncWasm));
    await initPngDecode(await compile(pngWasm));
    await initResize(await compile(resizeWasm));
  })();
  return ready;
}

export { decodeJpeg, encodeJpeg, decodePng, resize };
