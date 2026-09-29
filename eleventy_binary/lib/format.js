/**
 * Shared value formatting.
 *
 * One definition, because the download blocks and the status report describe
 * the same files to the same reader: two formatters drifted apart into decimal
 * and binary units, so the same 900 kB budget printed as "900 kB" in one place
 * and "879 kB" in the other.
 *
 * Decimal units throughout — they are what the byte limits in
 * site_settings.json are written in, and what a file manager shows.
 */
export function humanBytes(n) {
  const size = Number(n);
  if (!Number.isFinite(size)) return "";
  if (size >= 1_000_000_000) return `${(size / 1_000_000_000).toFixed(2)} GB`;
  if (size >= 1_000_000) return `${(size / 1_000_000).toFixed(1)} MB`;
  if (size >= 1_000) return `${Math.round(size / 1_000)} kB`;
  return `${size} bytes`;
}

/**
 * A usable Date, or null.
 *
 * One coercion, because four formatters carried their own copy of
 * `value instanceof Date ? value : new Date(value)` and all four shared its one
 * blind spot: `new Date(null)` is not an invalid date, it is midnight on 1
 * January 1970. Front matter written as a bare `date:` parses to null, so a page
 * that had simply forgotten its date was published, sorted and displayed as
 * fifty-six years old rather than reported as wrong. Empty string is rejected
 * for the same reason — `new Date("")` is at least NaN, but the intent is
 * identical and so should be the answer.
 */
export function toDate(value) {
  if (value == null || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Why a YYYY-MM-DD value is not a day on the calendar, or null when it is (or
 * does not start with that shape at all — the shape is checked separately).
 *
 * The YAML parser and `new Date()` both accept "2026-13-45" and roll it over,
 * so a typo in a month or a day published the page silently under another
 * date: 2027-02-14 for that one. The message names the date it would get.
 */
export function calendarDateFault(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? "").trim());
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const rolled = new Date(Date.UTC(year, month - 1, day));
  if (rolled.getUTCFullYear() === year && rolled.getUTCMonth() === month - 1 && rolled.getUTCDate() === day) {
    return null;
  }
  const what = month < 1 || month > 12 ? `there is no month ${match[2]}` : `month ${match[2]} has no day ${match[3]}`;
  return `${what}; it would be published as ${rolled.toISOString().slice(0, 10)}`;
}

/**
 * RFC-822 date, as RSS 2.0 requires for <pubDate>.
 *
 * Built from UTC components with the day and month names spelled out here
 * rather than through toLocaleString: the format is fixed English by
 * specification, and a locale-derived one would change with the machine the
 * build ran on. That is also why the offset is a literal "GMT" — the previous
 * output carried the builder's own timezone into every feed item.
 */
const RFC822_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const RFC822_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function rfc822Date(value) {
  const date = toDate(value);
  if (!date) return "";

  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${RFC822_DAYS[date.getUTCDay()]}, ` +
    `${pad(date.getUTCDate())} ${RFC822_MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} GMT`
  );
}

/**
 * JSON that is safe to print inside a <script> element, and still JSON.
 *
 * base.njk prints titles and descriptions into its ld+json block with `| safe`,
 * and the HTML parser ends a script at the first `</script` whatever the JSON
 * around it says: a post titled "Why </script> ends a block" closed the block
 * there, printed the rest of the JSON as page text and ran anything after it
 * as markup. A JSON unicode escape of `<` is the same character to a JSON
 * parser and no tag to an HTML one. The two line separators (U+2028, U+2029)
 * are escaped because older JavaScript engines reject them unescaped in a
 * string.
 */
const SCRIPT_UNSAFE = new RegExp(`[<>&${String.fromCharCode(0x2028, 0x2029)}]`, "g");

export function jsonForHtml(value) {
  const json = JSON.stringify(value);
  if (json === undefined) return json;
  return json.replace(SCRIPT_UNSAFE, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
