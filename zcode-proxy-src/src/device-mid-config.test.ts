/**
 * Ticket 69 (Owner Proxy round 14 Q2): `ensureDeviceMidInConfig` reads the
 * device mid from the rest of the `deviceMid:` line only, so it agrees with
 * `loadConfig` on every spelling. An empty unquoted `deviceMid:` used to make
 * the reader take the next line's text (`appVersion: "3.8.1`) as an existing
 * mid: it skipped its fill, and the proxy, whose loader reads that line as
 * empty, ran with no mid at all.
 *
 * Every form runs once as LF and once as CRLF, with the generated UUID pinned,
 * and checks:
 *   (a) `loadConfig(path).identity.deviceMid` equals the returned value, and
 *       the identity headers carry it;
 *   (b) a second call returns the same value and leaves the file byte-identical
 *       (it is given a different UUID, so a second fill would show);
 *   (c) the file keeps its line endings (ticket 68's contract).
 * The expected bytes are literals, so the same table shows that every form
 * other than the empty unquoted ones comes out exactly as before.
 *
 * Temp-file fixtures only (B2/B3).
 */
import { describe, it, expect, spyOn, afterEach } from "bun:test";
import * as crypto from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureDeviceMidInConfig } from "./index.js";
import { loadConfig } from "./config/loader.js";
import { buildIdentityHeaders } from "./proxy/identity.js";

/** The UUID the first call generates. */
const PIN = "6b0f3c1e-9d2a-4f47-8e15-3c7a2d9b4e60";
/** What `randomUUID` returns from the second call on: a second fill would write it. */
const PIN_AGAIN = "a1b2c3d4-e5f6-4a7b-9c8d-0e1f2a3b4c5d";
/** A mid the file already holds. */
const EXISTING = "0f1e2d3c-4b5a-4978-8796-a5b4c3d2e1f0";

interface Form {
  name: string;
  /** The user's file, written with LF breaks (the CRLF run converts them). */
  before: string;
  /** The file after the call, with LF breaks. */
  after: string;
  /** The value the call returns. */
  mid: string;
}

const FORMS: Form[] = [
  {
    name: "a quoted value",
    before: `identity:\n  appVersion: "3.8.1"\n  deviceMid: "${EXISTING}"\nother: 1\n`,
    after: `identity:\n  appVersion: "3.8.1"\n  deviceMid: "${EXISTING}"\nother: 1\n`,
    mid: EXISTING,
  },
  {
    name: "an unquoted value",
    before: `identity:\n  deviceMid: ${EXISTING}\n  appVersion: "3.8.1"\n`,
    after: `identity:\n  deviceMid: ${EXISTING}\n  appVersion: "3.8.1"\n`,
    mid: EXISTING,
  },
  {
    name: "an empty quoted value",
    before: `identity:\n  deviceMid: ""\n  appVersion: "3.8.1"\n`,
    after: `identity:\n  deviceMid: "${PIN}"\n  appVersion: "3.8.1"\n`,
    mid: PIN,
  },
  {
    name: "an empty unquoted value followed by another key",
    before: `identity:\n  deviceMid:\n  appVersion: "3.8.1"\n`,
    after: `identity:\n  deviceMid: "${PIN}"\n  appVersion: "3.8.1"\n`,
    mid: PIN,
  },
  {
    name: "an empty unquoted value followed by a blank line",
    before: `identity:\n  deviceMid:\n\n  appVersion: "3.8.1"\n`,
    after: `identity:\n  deviceMid: "${PIN}"\n\n  appVersion: "3.8.1"\n`,
    mid: PIN,
  },
  {
    name: "an empty unquoted value with trailing spaces",
    before: `identity:\n  deviceMid: \t \n  appVersion: "3.8.1"\n`,
    after: `identity:\n  deviceMid: "${PIN}"\n  appVersion: "3.8.1"\n`,
    mid: PIN,
  },
  {
    name: "an empty unquoted value on the last line, with a final newline",
    before: `server:\n  port: 8080\nidentity:\n  deviceMid:\n`,
    after: `server:\n  port: 8080\nidentity:\n  deviceMid: "${PIN}"\n`,
    mid: PIN,
  },
  {
    name: "an empty unquoted value on the last line, without a final newline",
    before: `server:\n  port: 8080\nidentity:\n  deviceMid:`,
    after: `server:\n  port: 8080\nidentity:\n  deviceMid: "${PIN}"`,
    mid: PIN,
  },
  {
    name: "no deviceMid key under identity:",
    before: `identity:\n  appVersion: "3.8.1"\nother: 1\n`,
    after: `identity:\n  deviceMid: "${PIN}"\n  appVersion: "3.8.1"\nother: 1\n`,
    mid: PIN,
  },
  {
    name: "no identity: block",
    before: `server:\n  port: 8080\n`,
    after: `server:\n  port: 8080\nidentity:\n  deviceMid: "${PIN}"\n`,
    mid: PIN,
  },
];

const EOLS = [
  ["LF", "\n"],
  ["CRLF", "\r\n"],
] as const;

let dir: string | undefined;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("ensureDeviceMidInConfig reads the device mid from its own line", () => {
  for (const form of FORMS) {
    for (const [eolName, eol] of EOLS) {
      it(`${form.name} (${eolName})`, () => {
        const withEol = (text: string) => text.replace(/\n/g, eol);
        dir = mkdtempSync(join(tmpdir(), "zcode-t69-"));
        const path = join(dir, "config.yaml");
        writeFileSync(path, withEol(form.before), "utf-8");

        const uuid = spyOn(crypto, "randomUUID").mockReturnValueOnce(PIN).mockReturnValue(PIN_AGAIN);
        try {
          const mid = ensureDeviceMidInConfig(path);
          const written = readFileSync(path, "utf-8");

          expect(mid).toBe(form.mid);
          expect(written).toBe(withEol(form.after));

          // (a) the function and the loader read the same mid, and it is the one sent.
          const identity = loadConfig(path).identity;
          expect(identity.deviceMid).toBe(mid);
          expect(buildIdentityHeaders(identity)["X-Device-Mid"]).toBe(form.mid);

          // (b) a repeat call finds the mid and does not write.
          expect(ensureDeviceMidInConfig(path)).toBe(mid);
          expect(readFileSync(path, "utf-8")).toBe(written);

          // (c) the line endings are the file's own.
          if (eol === "\r\n") expect(written.match(/(?<!\r)\n/g) ?? []).toEqual([]);
          else expect(written).not.toContain("\r");
        } finally {
          uuid.mockRestore();
        }
      });
    }
  }
});
