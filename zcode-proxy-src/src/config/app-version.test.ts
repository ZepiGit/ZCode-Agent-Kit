import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CURRENT_APP_VERSION, migrateRetiredAppVersion, migrateRetiredAppVersionFile } from "./app-version.js";

describe("migrateRetiredAppVersion", () => {
  it("rewrites only the retired shipped default, in place", () => {
    const source = [
      "# keep 3.14.3 in this comment",
      "identity:",
      "  appVersion: \"3.14.3\"  # previous default",
      "  sourceTitle: \"cli\"",
      "custom: true",
      "",
    ].join("\n");
    const migrated = migrateRetiredAppVersion(source);
    expect(migrated).toContain(`appVersion: "${CURRENT_APP_VERSION}"  # previous default`);
    expect(migrated).toContain("# keep 3.14.3 in this comment");
    expect(migrated).toContain("custom: true");
    expect(migrated).not.toMatch(/^[\t ]*appVersion:.*3\.14\.3/m);
    expect(migrateRetiredAppVersion(migrated)).toBe(migrated);
  });

  it("leaves a chosen version and other spellings alone", () => {
    for (const line of ["  appVersion: \"3.11.2\"", "  appVersion: '4.1.0'", "  appVersion: 9.9.9", "appVersion: \"3.14.30\""]) {
      expect(migrateRetiredAppVersion(`${line}\n`)).toBe(`${line}\n`);
    }
  });

  it("keeps a CRLF file CRLF", () => {
    const source = "identity:\r\n  appVersion: \"3.14.3\"\r\n  sourceTitle: \"cli\"\r\n";
    const migrated = migrateRetiredAppVersion(source);
    expect(migrated).toBe(`identity:\r\n  appVersion: "${CURRENT_APP_VERSION}"\r\n  sourceTitle: \"cli\"\r\n`);
    expect(migrated.includes("\n") && !migrated.includes("\r\n")).toBe(false);
  });

  it("rewrites the file once", () => {
    const dir = mkdtempSync(join(tmpdir(), "app-version-"));
    try {
      const path = join(dir, "config.yaml");
      writeFileSync(path, "identity:\n  appVersion: \"3.14.3\"\n# note\n");
      expect(migrateRetiredAppVersionFile(path)).toBe(true);
      expect(readFileSync(path, "utf8")).toBe(`identity:\n  appVersion: "${CURRENT_APP_VERSION}"\n# note\n`);
      expect(migrateRetiredAppVersionFile(path)).toBe(false);
      expect(migrateRetiredAppVersionFile(join(dir, "missing.yaml"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
