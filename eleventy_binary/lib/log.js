/**
 * Shared build logger.
 *
 * Every module reports through here rather than calling console directly, so
 * the generator can print a single ordered summary at the end and the
 * status_check page can render exactly the same findings the terminal showed.
 */

class BuildLog {
  constructor() {
    this.entries = [];
    this.quiet = false;
  }

  #push(level, scope, message, detail) {
    const entry = { level, scope, message, detail: detail ?? null };
    this.entries.push(entry);
    if (this.quiet && level === "note") return entry;
    const tag = { error: "ERROR", warn: " WARN", note: " NOTE" }[level];
    const line = `[${tag}] ${scope}: ${message}${detail ? ` — ${detail}` : ""}`;
    (level === "error" ? console.error : console.log)(line);
    return entry;
  }

  error(scope, message, detail) { return this.#push("error", scope, message, detail); }
  warn(scope, message, detail) { return this.#push("warn", scope, message, detail); }
  note(scope, message, detail) { return this.#push("note", scope, message, detail); }

  info(message) { if (!this.quiet) console.log(message); }

  count(level) { return this.entries.filter((e) => e.level === level).length; }

  summary() {
    return {
      errors: this.count("error"),
      warnings: this.count("warn"),
      notes: this.count("note"),
    };
  }
}

export const log = new BuildLog();
export default log;
