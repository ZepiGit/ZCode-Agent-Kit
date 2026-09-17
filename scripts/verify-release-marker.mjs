// prepublishOnly gate inside the generated launcher package (ZAK-012): an
// `npm publish` from the package must fail unless the shipped ALLOW_PUBLISH
// marker names the version being published. This is a version consistency
// check; the owner-authorized workflow creates the marker automatically.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(scriptDir, "..", "package.json"), "utf8"));
const markerFile = join(scriptDir, "..", "ALLOW_PUBLISH");

if (!existsSync(markerFile)) {
  console.error(
    "publish refused: this package carries no ALLOW_PUBLISH marker " +
    "(rebuild with pack/ALLOW_PUBLISH committed to the repo).",
  );
  process.exit(1);
}
const marker = readFileSync(markerFile, "utf8");
const allowed = marker.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
if (!allowed.includes(pkg.version)) {
  console.error(
    `publish refused: ALLOW_PUBLISH does not name version ${pkg.version}. ` +
    `Add a line "${pkg.version}" to pack/ALLOW_PUBLISH and rebuild.`,
  );
  process.exit(1);
}
console.log(`release marker consistency OK for ${pkg.name}@${pkg.version}`);
