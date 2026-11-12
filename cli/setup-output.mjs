// The setup report.
//
// Compact is the default: stage rows, one result row per assistant, the
// connection check, the connection details and the undo command on screen.
// The full output — every line the command prints, in the verbose shape the
// command always had — goes to install.log in every mode, and to the screen
// with `--verbose` / ZCODE_KIT_VERBOSE=1. `--installer` stays accepted (it
// only suppresses the banner the installers print themselves: one banner).
// Every WARN/FAIL keeps what/why/next on screen in both modes.
//
// Compact renders through the CLI output module (Out, lib/term/out.mjs):
// report rows on stdout, progress and diagnostics on stderr. The log file is
// the second sink: the verbose-shaped lines are appended there whatever the
// screen mode, so the install.log line-set comparison against the old verbose
// output holds (tests/install-log-lines.test.mjs).
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Detail lines that must surface on the compact screen (today's rule). */
const SURFACE_PATTERN = /\bWARN:|MANUAL STEP REQUIRED/;

/**
 * The ui object setup.mjs renders through. `out` is the Out instance
 * (injected so the snapshot harness can render every C3 variant), `log` the
 * install.log append sink, `verbose` the full-output screen mode. `stdout`/
 * `stderr` are the streams the spinner guard moves lines below (the same
 * objects `out` writes to).
 */
export function setupUi({ out, log, verbose = false, banner = [], stdout = process.stdout, stderr = process.stderr }) {
  let activeStep = null; // a running Out.step (stages 1/4); kit lines move below it
  let pendingBlock = null; // a surfaced warn awaiting its indented next-lines

  // A kit-routed screen write during an active spinner moves to a fresh line
  // first; the spinner's next redraw takes the line below it. The two writes
  // are synchronous back-to-back, so the redraw timer cannot interleave.
  const belowSpinner = (stream) => { if (activeStep) stream.write("\n"); };
  const report = (fn) => { belowSpinner(stdout); fn(); };
  const warnBlock = (block) => { belowSpinner(stderr); out.warn(block); };

  const flushSurfaced = () => {
    if (!pendingBlock) return;
    const block = pendingBlock;
    pendingBlock = null;
    warnBlock(block.next.length ? block : { what: block.what });
  };

  const plain = (text) => {
    log(text);
    if (verbose) console.log(text);
  };

  // The kit banner: setup's own runs print it; installer mode passes no
  // banner lines because the installers print it themselves (one banner).
  for (const line of [...banner, ""]) {
    log(line);
    if (verbose) console.log(line);
    else out.data(line);
  }

  return {
    logPath: null,
    out,

    /** One report render and one canonical plain log append in every mode. */
    commands(rows, opts) {
      const text = out.commandsText(rows, opts); // validate before either real sink
      flushSurfaced();
      report(() => out.commands(rows, opts));
      log(text.slice(0, -1)); // existing log callback appends exactly one LF
    },

    /** Full-output line: install.log always; the screen only in verbose. */
    detail(...args) {
      const text = args.join(" ");
      log(text);
      if (verbose) return void console.log(text);
      // Compact: a WARN/MANUAL STEP line surfaces as a block (what/why/next);
      // the ≥4-space-indented lines after it join the block as its next
      // commands (bootstrap's manual-step login commands), until a line that
      // is not a continuation arrives.
      if (pendingBlock && /^ {4,}\S/.test(text)) {
        pendingBlock.next.push(text.trim());
        return;
      }
      flushSurfaced();
      if (SURFACE_PATTERN.test(text)) pendingBlock = { what: text.trim().replace(/^WARN: /, ""), next: [] };
    },

    /** Called whenever a surfaced block must not wait longer for continuations. */
    flush() { flushSurfaced(); },

    /** A line both modes showed before (rotator lines, hints, check rows): screen in both, log always. */
    progress(line) {
      log(line);
      if (verbose) return void console.log(line);
      flushSurfaced();
      const text = line.replace(/^\n/, "");
      const m = text.match(/^\s*\[(OK|INFO|SKIP|FAIL|WARN)\]\s*(.*)$/);
      if (!m) return void report(() => out.data(text));
      const [, tag, rest] = m;
      if (tag === "WARN") return warnBlock({ what: rest });
      const status = { OK: "ok", INFO: "info", SKIP: "skip", FAIL: "fail" }[tag];
      report(() => out.result({ status, label: rest }));
    },

    progressError(line) {
      log(line);
      if (verbose) return void console.error(line);
      flushSurfaced();
      warnBlock({ what: line.replace(/^WARN: /, "").trim() });
    },

    /** A prompt-context note: stderr row above the question. */
    note(text) {
      plain(`  note: ${text}`);
      if (verbose) return;
      belowSpinner(stderr);
      out.note(text);
    },

    /** Stage 1/4: TTY progress via Out.step. */
    step(label) {
      if (verbose) return { done() {}, skip() {}, fail() {} };
      const progress = out.step(label);
      activeStep = progress;
      const finish = (fn) => (arg) => { activeStep = null; fn(arg); };
      return {
        done: finish((detail) => progress.done(detail)),
        skip: finish((reason) => progress.skip(reason)),
        fail: finish((block) => progress.fail(block)),
      };
    },

    /** Stage 2/3 heading: a stdout section header (report structure). */
    heading(title) {
      log(`== ${title} ==`);
      if (verbose) return;
      report(() => out.heading(title));
    },

    /** Per-assistant results: shown in both modes (the consent answer's outcome). */
    result(tag, text) {
      const mark = tag === "ok" ? "[OK]  " : tag === "skip" ? "[SKIP]" : "[FAIL]";
      plain(`  ${mark} ${text}`);
      if (verbose) return;
      report(() => out.result({ status: tag, label: text }));
    },

    warn(text) {
      plain(`  [WARN] ${text}`);
      if (verbose) return;
      warnBlock({ what: text.trim().replace(/^WARN: /, "") });
    },

    /** The end block: the old lines verbatim (log + verbose) and the compact kv rows. */
    saved(lines, pairs) {
      lines.forEach((line, i) => plain(`${i === 0 ? "\n" : ""}  ${line}`));
      if (verbose) return;
      report(() => {
        out.data("");
        out.kv(pairs);
      });
    },

    /** Verbatim stdout rows (connection details card). */
    dataLine(text) {
      log(text);
      if (verbose) return void console.log(text);
      report(() => out.data(text));
    },

    /** The kit banner (setup's own runs; installer mode prints its own). */
    banner(lines) {
      for (const line of [...lines, ""]) {
        log(line);
        if (verbose) console.log(line);
        else report(() => out.data(line));
      }
    },
  };
}

/**
 * Compact installer output; full adapter diagnostics remain available in a
 * private log. Compact is the default; `verbose` prints the full
 * stream; `banner` lines are the kit banner (suppressed in installer mode:
 * the installers print it themselves — one banner).
 */
export async function setupOutput(ctx, { verbose = false, banner = [] } = {}) {
  const { loadOutput } = await import("../lib/term/load.mjs");
  const out = await loadOutput();
  const logPath = join(ctx.logDir, "install.log");
  mkdirSync(ctx.logDir, { recursive: true, mode: 0o700 });
  writeFileSync(logPath, `ZCode Agent Kit setup - ${new Date().toISOString()}\n`, { mode: 0o600 });
  const ui = setupUi({ out, log: (text) => appendFileSync(logPath, text + "\n"), verbose, banner });
  ui.logPath = logPath;
  return ui;
}
