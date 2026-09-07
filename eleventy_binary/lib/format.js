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
