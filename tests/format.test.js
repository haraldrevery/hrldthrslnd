/**
 * format.js — one date coercion and one byte formatter, shared by everything
 * that renders either. Both exist because copies of them had drifted apart.
 */
import { test, expect, describe } from "bun:test";
import { humanBytes, toDate, rfc822Date, calendarDateFault, jsonForHtml } from "../eleventy_binary/lib/format.js";

describe("calendarDateFault", () => {
  test("a real day is fine, a leap day only in a leap year", () => {
    expect(calendarDateFault("2026-09-29")).toBeNull();
    expect(calendarDateFault("2024-02-29")).toBeNull();
    expect(calendarDateFault("2026-09-29T10:00")).toBeNull();
  });

  test("an impossible month or day names the date it would roll over to", () => {
    expect(calendarDateFault("2026-13-45")).toContain("2027-02-14");
    expect(calendarDateFault("2026-02-29")).toContain("2026-03-01");
    expect(calendarDateFault("2026-04-31")).toContain("no day 31");
    expect(calendarDateFault("2026-00-10")).toContain("no month 00");
  });

  test("anything not shaped YYYY-MM-DD is left to the shape check", () => {
    expect(calendarDateFault("yesterday")).toBeNull();
    expect(calendarDateFault("")).toBeNull();
    expect(calendarDateFault(undefined)).toBeNull();
  });
});

describe("jsonForHtml", () => {
  test("cannot close the <script> element it is printed into", () => {
    const title = "Why </script><script>alert(1)</script> & more";
    const out = jsonForHtml({ title });
    expect(out).not.toContain("<");
    expect(out).not.toContain(">");
    expect(JSON.parse(out).title).toBe(title);
  });

  test("escapes the two line separators and still round-trips", () => {
    const text = `a${String.fromCharCode(0x2028)}b${String.fromCharCode(0x2029)}c`;
    const out = jsonForHtml(text);
    expect(out).toBe('"a\\u2028b\\u2029c"');
    expect(JSON.parse(out)).toBe(text);
  });

  test("undefined stays undefined, as JSON.stringify has it", () => {
    expect(jsonForHtml(undefined)).toBeUndefined();
  });
});

describe("humanBytes", () => {
  test("decimal units, matching the budgets in site_settings.json", () => {
    expect(humanBytes(900_000)).toBe("900 kB");
    expect(humanBytes(1_500_000)).toBe("1.5 MB");
    expect(humanBytes(2_000_000_000)).toBe("2.00 GB");
    expect(humanBytes(512)).toBe("512 bytes");
  });

  test("a value that is not a number formats as nothing", () => {
    expect(humanBytes(undefined)).toBe("");
    expect(humanBytes("abc")).toBe("");
  });
});

describe("toDate", () => {
  test("parses a date string and passes a Date through", () => {
    expect(toDate("2026-02-05")?.toISOString().slice(0, 10)).toBe("2026-02-05");
    const d = new Date("2026-02-05");
    expect(toDate(d)).toBe(d);
  });

  test("null and empty string are 'no date', not the Unix epoch", () => {
    // `new Date(null)` is midnight on 1 January 1970, so a page that had simply
    // forgotten its date used to be published as fifty-six years old.
    expect(toDate(null)).toBe(null);
    expect(toDate(undefined)).toBe(null);
    expect(toDate("")).toBe(null);
  });

  test("an unparseable value is null rather than an Invalid Date", () => {
    expect(toDate("not a date")).toBe(null);
  });
});

describe("rfc822Date", () => {
  test("RSS 2.0 pubDate format, in GMT, with fixed English names", () => {
    // Built from UTC components rather than toLocaleString: the format is fixed
    // English by specification, and the offset must not carry the build
    // machine's own timezone into every feed item.
    expect(rfc822Date("2026-02-05T09:07:03Z")).toBe("Thu, 05 Feb 2026 09:07:03 GMT");
  });

  test("a date-only string is midnight UTC", () => {
    expect(rfc822Date("2026-09-06")).toBe("Sun, 06 Sep 2026 00:00:00 GMT");
  });

  test("no date formats as an empty string", () => {
    expect(rfc822Date(null)).toBe("");
    expect(rfc822Date("")).toBe("");
  });
});
