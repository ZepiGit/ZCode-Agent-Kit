/**
 * Offline solver backend without dependencies, for the compiled-proxy test in
 * solver-process.test.ts: a compiled binary resolves no packages from disk for
 * a module it loads from outside its bundle, so this backend imports nothing.
 * Scenes: token:<label>, pid, argv.
 */
const param = (label: string) => Buffer.from(JSON.stringify({
  certifyId: label, sceneId: "fixture", isSign: true, securityToken: "fixture-".repeat(40),
})).toString("base64");

export async function solveTraceless({ scene }: { scene: string }): Promise<string> {
  const [kind, arg] = scene.split(":");
  switch (kind) {
    case "token":
      return param(`token:${arg}`);
    case "pid":
      return param(`pid:${process.pid}`);
    case "argv":
      return param(`argv:${JSON.stringify({ argv: process.argv, execArgv: process.execArgv, execPath: process.execPath })}`);
    default:
      throw new Error(`unknown fixture scene ${scene}`);
  }
}
