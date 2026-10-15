/**
 * The cinematic title card's title, one letter at a time.
 *
 * Two pages open with a .cine-stage: the front page (index.njk, through the
 * `cineHeading` filter) and any page-builder post whose hero is the title card
 * (render.js). Both write the title's letters through this, so the two cannot
 * develop differently. The rest of the card is markup; this is the one part
 * that is computed, because every letter needs its own delay.
 *
 * DELAYS is a fixed table, not a random draw. The values are the ones frozen
 * into block_test_page_e.html, and a fixed table is what keeps the page static:
 * the scatter is identical on every build and every visit, so the markup is
 * cacheable and the title develops the same way twice.
 *
 * The stride of 7 is why the table is not simply read from the start for each
 * word. 7 and 15 are coprime, so a word beginning at offset 7·n lands on a
 * different run of the table than the word before it; read from index 0 every
 * time and a two-word title would develop both words in step, which is the one
 * pattern the scatter exists to avoid.
 *
 * Words are separated by a space in the markup. .cine-title is a flex row, so
 * the space is never drawn (column-gap is the word space), but it is what
 * turns the letters back into words for anything that reads the text rather
 * than the layout: the search index, a reader view, a copy and paste.
 *
 * A letter is a grapheme, not a UTF-16 unit, so an accented letter written as
 * a base and a combining mark, or an emoji, stays one inline-block. A no-break
 * space ties two words into one, as it does in the other heroes' titles (see
 * WORD_GAP in render.js).
 *
 * A line break in the title is a .cine-break: a flex item a whole line wide,
 * so the next word starts a new line where there is room for it, and dropped
 * on a short screen the way .hero-break is on the other heroes.
 *
 * The h1 carries its longest word's measurements: --cine-word, the letters in
 * it, and --cine-word-em, its width in em before tracking, from the face's own
 * advances (font_metrics.js, through the resolver). Letters are inline-blocks,
 * and a line may break between any two of them, so a word wider than the card
 * breaks in the middle — "Galdhøpiggen" did on a phone. The stylesheet caps
 * the title's size so that word fits; see .cine-title.
 */
import { escapeHtml } from "../paths.js";

const DELAYS = [0.32, 1.05, 0.61, 0.88, 0.14, 1.22, 0.47, 0.73,
                1.36, 0.09, 0.96, 0.52, 1.11, 0.28, 0.67];
const STRIDE = 7;

/** The spaces between words: any white space but the no-break kinds. */
const WORD_GAP = /[^\S   ]+/;

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** The title's lines, trimmed, without the empty ones. */
function linesOf(title) {
  return String(title ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

/** The title as one line, for the h1's aria-label. */
export function cineLabel(title) {
  return linesOf(title).join(" ");
}

/**
 * The title's words, each as its graphemes: what the letters are made of, and
 * what the longest word is measured in.
 */
function wordsOf(title) {
  return linesOf(title).map((line) =>
    line.split(WORD_GAP).filter(Boolean).map((w) => Array.from(graphemes.segment(w), ({ segment }) => segment)),
  );
}

/**
 * The inside of a .cine-title h1: a span per word, aria-hidden, holding a
 * .cine-letter per grapheme with its --letter-delay.
 */
export function cineTitle(title) {
  let word = 0;
  return wordsOf(title)
    .map((line) =>
      line
        .map((letters) => {
          const start = STRIDE * word++;
          const spans = letters.map((letter, i) =>
            `<span class="cine-letter" style="--letter-delay:${DELAYS[(start + i) % DELAYS.length]}s">${escapeHtml(letter)}</span>`,
          ).join("");
          return `<span aria-hidden="true">${spans}</span>`;
        })
        .join(" "),
    )
    .join(' <span class="cine-break" aria-hidden="true"></span> ');
}

/**
 * What a letter the face cannot measure counts as, in em: wider than any
 * capital in a text face. Such a letter is drawn by a fallback font whose width
 * cannot be known here, so it is allowed more than it is likely to take.
 */
const UNMEASURED = 1;

/**
 * A word as the stylesheet draws it: its width in em before tracking, and how
 * many letters the tracking follows. Uppercased first, as .cine-title is, and
 * that can make one letter two — "ß" is drawn "SS", two advances and two
 * trackings.
 */
function measure(letters, resolver) {
  let em = 0;
  let count = 0;
  for (const letter of letters) {
    const drawn = letter.toUpperCase().normalize("NFC");
    count += Array.from(graphemes.segment(drawn)).length;
    for (const char of drawn) em += resolver?.glyphAdvance?.(char) ?? UNMEASURED;
  }
  return { em, count };
}

/**
 * The whole h1: the readable title as its aria-label (the letters are
 * aria-hidden, so a screen reader hears the title once, not letter by letter),
 * the longest word's measurements, and the letters.
 *
 * The two measurements are each the largest of any word's, which need not be
 * the same word's: a word of many narrow letters and a shorter one of wide
 * letters trade places as the tracking widens. The pair is never narrower than
 * any word at any tracking, and where one word is longest both ways — nearly
 * every title — it is that word exactly. The width is rounded up, so rounding
 * cannot shrink it either.
 *
 * `resolver` answers glyphAdvance(); without one, every letter is unmeasured.
 */
export function cineHeading(title, resolver) {
  const words = wordsOf(title).flat().map((letters) => measure(letters, resolver));
  const count = Math.max(1, ...words.map((w) => w.count));
  const em = Math.ceil(Math.max(0, ...words.map((w) => w.em)) * 1000) / 1000;
  return `<h1 class="cine-title" aria-label="${escapeHtml(cineLabel(title))}" style="--cine-word:${count};--cine-word-em:${em}">${cineTitle(title)}</h1>`;
}
