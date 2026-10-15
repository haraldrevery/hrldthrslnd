/**
 * Advance widths read from the site's font file, for the title card's size cap.
 *
 * The expected values are not read from the font by other means: they are what
 * Chromium drew, measured as each capital's inline-block at 0.14em tracking
 * less that tracking. The cap is only right if the file and the browser agree.
 */
import { test, expect, describe } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import { faceAdvances, parseAdvances, TEXT_FACE } from "../eleventy_binary/lib/font_metrics.js";
import { diskResolver } from "../eleventy_binary/lib/resolver.js";

const REPO = path.resolve(import.meta.dirname, "..");
const FACE = path.join(REPO, TEXT_FACE);

describe("font_metrics.js", () => {
  test("the face's capitals are the widths the browser draws", () => {
    const advance = faceAdvances(FACE);
    const drawn = { A: 0.445, I: 0.132, M: 0.558, W: 0.558, O: 0.547, G: 0.547, Ø: 0.548, J: 0.409 };
    for (const [letter, em] of Object.entries(drawn)) expect(advance(letter)).toBeCloseTo(em, 3);
  });

  test("a no-break space the face lacks is its space; a character it lacks is unmeasured", () => {
    const advance = faceAdvances(FACE);
    expect(advance(" ")).toBe(advance(" "));
    expect(advance("中")).toBeNull();
    expect(advance("👍")).toBeNull();
  });

  test("format 4 reads the same widths as format 12", () => {
    // The site's face carries both. Hide the format 12 subtables and the
    // reader falls back to format 4, which is all a font limited to the Basic
    // Multilingual Plane has.
    const bytes = new Uint8Array(fs.readFileSync(FACE));
    const view = new DataView(bytes.buffer);
    let cmap = 0;
    for (let i = 0; i < view.getUint16(4); i++) {
      const record = 12 + 16 * i;
      if (String.fromCharCode(...bytes.subarray(record, record + 4)) === "cmap") cmap = view.getUint32(record + 8);
    }
    for (let i = 0; i < view.getUint16(cmap + 2); i++) {
      const record = cmap + 4 + 8 * i;
      if (view.getUint16(cmap + view.getUint32(record + 4)) === 12) view.setUint16(record, 9);
    }
    const basic = parseAdvances(bytes);
    const full = faceAdvances(FACE);
    for (const char of "ABCDEFGHIJKLMNOPQRSTUVWXYZÆØÅÖÜ0123456789 .,!?- ") expect(basic(char)).toBe(full(char));
    expect(basic("中")).toBeNull();
  });

  test("a missing file, or one that is not a font, measures nothing", () => {
    expect(faceAdvances(path.join(REPO, "font/no_such_face.ttf"))("A")).toBeNull();
    expect(faceAdvances(path.join(REPO, "package.json"))("A")).toBeNull();
  });

  test("the build's resolver measures in the face the stylesheet sets the body in", () => {
    expect(diskResolver(REPO).glyphAdvance("M")).toBeCloseTo(0.558, 3);
    // The title card inherits the body's face. That face, and the file read
    // for it here, must be the same one.
    const theme = fs.readFileSync(path.join(REPO, "css/theme.css"), "utf8");
    expect(theme).toMatch(/--font-text-family:\s*"Harald Revery Text"/);
    const input = fs.readFileSync(path.join(REPO, "css/input.css"), "utf8");
    const face = input.match(/@font-face\s*{[^}]*font-family:\s*"Harald Revery Text"[^}]*}/)?.[0];
    expect(face).toContain(`url("/${TEXT_FACE}")`);
  });
});
