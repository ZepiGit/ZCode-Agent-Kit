# TypeScript toolchain for mcp/zcode-harness-mcp and zcode-proxy-src (research, 2026-11-05)

## Answer

1. The latest stable TypeScript is **7.0.2** (npm `latest`, 2026-07-08). It is the native Go port, published under the plain `typescript` package. It provides a native `tsc` and ships **no JS API**. 6.0.3 (2026-04-16) is the last JS-based line. 5.9.3 (2025-09-30) is what the bridge locks today. 7.1 is in beta (7.1.0-beta, 2026-10-20).
2. The bridge's `tsconfig.json` already meets every 6.0/7.0 change. It sets `types: ["node"]`, `rootDir: "src"`, `strict: true` and `esModuleInterop: true`. Its `module`/`moduleResolution` is `Node16`, which is not deprecated. It uses none of the removed options (`baseUrl`, `outFile`, `es5`, `node10`, `classic`, `asserts` imports, `module` namespaces), and nothing imports the `typescript` API. No tsconfig edit is required.
3. Recommendation: `"typescript": "7.0.2"` (exact) and `"@types/node": "^24.19.2"`. The types should match the `>=24` floor, not the 26 CI leg. 24.19.2 was published 2026-10-09, and `src/` uses only long-standing fs/path/os/crypto/child_process/http APIs. Regenerate both `bun.lock` and `package-lock.json`, because TS 7 adds 20 per-platform optional packages. If 7.0.2 misbehaves, fall back to `6.0.3`.
4. Pin `@types/bun` to **`1.4.4`** (exact, published 2026-10-23; it depends on `bun-types@1.4.4`) so it matches the Bun 1.4.4 runtime pin. `"latest"` is currently locked at 1.3.14. The proxy has no `typescript` devDependency, so `bun x tsc` (Bun aliases `tsc` to `typescript`) downloads whatever `typescript@latest` is at that moment, which is 7.0.2 today. Add `"typescript": "7.0.2"` there too.
5. Effect on committed `dist/`: changing `@types/*` cannot change emitted JS. Only the 5.9.3→7.0.2 compiler swap can. None of the 6.0 default changes apply, because this config sets every one of those options explicitly. Whether the emitted JS stays byte-identical is **UNVERIFIED**. Rebuild once and check `git diff --stat mcp/zcode-harness-mcp/dist` before committing. Expect no changes or only cosmetic ones.

## Details

### 1. Release status (as of 2026-11-05)

Source for versions and timestamps: npm registry document for `typescript` (https://registry.npmjs.org/typescript, fetched 2026-11-05). Dist-tags: `latest: 7.0.2`, `beta: 7.1.0-beta`, `rc: 7.0.1-rc`, `next: 7.1.0-dev.20261105.1`.

| Version | Published (npm `time`) | Notes |
|---|---|---|
| 5.9.2 | 2025-07-31 | 5.9 GA (blog dated 2025-08-01) |
| 5.9.3 | 2025-09-30 | currently locked in `mcp/zcode-harness-mcp/bun.lock:189` and `package-lock.json:1162-1163` |
| 6.0.2 | 2026-03-23 | 6.0 GA ("Announcing TypeScript 6.0", 2026-03-23) |
| 6.0.3 | 2026-04-16 | last 6.x; no later 6.x on npm |
| 7.0.0-beta | 2026-04-21 (blog) | shipped as `@typescript/native-preview`, binary `tsgo` |
| 7.0.1-rc | 2026-06-18 | |
| 7.0.2 | 2026-07-08 | 7.0 GA, `latest` |
| 7.1.0-beta | 2026-10-20 | |

- 7.0 is the native port, published as `typescript`: "Just as with any other release, TypeScript 7 is available via npm: `npm install -D typescript` … That will get you the new `tsc` executable" (https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/, 2026-07-08).
- There is no API: "While TypeScript 7.0 is here, it does not ship with an API. We expect TypeScript 7.1 to ship with a new (and different) API". The registry confirms this. `typescript@7.0.2` has `main: null`, a single `bin: {tsc}` (no `tsserver`), `engines.node >=16.20.0`, and 20 `@typescript/typescript-<platform>` optional dependencies (registry, above).
- 6.0 in parallel: the compatibility package `@typescript/typescript6` provides a `tsc6` executable and re-exports the 6.0 API (7.0 blog, above). Its npm `latest` is 6.0.2, published 2026-07-06 (https://registry.npmjs.org/@typescript/typescript6).
- 7.0 and 6.0 behave the same: "Practically any TypeScript code that compiles cleanly with TypeScript 6.0 (with the `stableTypeOrdering` flag on, and without any `ignoreDeprecations` flag set) should compile identically in TypeScript 7.0 … TypeScript 7.0 adopts 6.0's new defaults, and provides hard errors in the face of any flags and constructs deprecated in TypeScript 6.0." (7.0 blog, above).
- Nobody here depends on the TS API. A repo-wide grep finds no `from "typescript"` or `require("typescript")` outside `node_modules`. The only TS consumers are `mcp/zcode-harness-mcp/package.json:14` (`"build": "tsc -p tsconfig.json"`) and `bun x tsc --noEmit` in `zcode-proxy-src/.github/workflows/ci.yml:41` and `release.yml:58`. The 7.0 limitation ("Projects using Vue, MDX, Astro, Svelte … will need to continue using TypeScript 6.0") does not apply.

### 2. Breaking changes from 5.9 checked against `mcp/zcode-harness-mcp`

Primary list: TypeScript 6.0 release notes (https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html, accessed 2026-11-05) and the "hard errors" list in the 7.0 blog (above).

| 6.0/7.0 change | Bridge config (`mcp/zcode-harness-mcp/tsconfig.json`) | Impact |
|---|---|---|
| `types` defaults to `[]` | `"types": ["node"]` (:20) | none, already explicit |
| `rootDir` defaults to the tsconfig dir (`.`) | `"rootDir": "src"` (:8) | none. Without it, output would move to `dist/src/…` |
| `strict` defaults to `true` | `"strict": true` (:9) | none |
| `module` defaults to `esnext`; `target` floats (es2025) | `"module": "Node16"` (:4), `"target": "ES2023"` (:3) | none, both explicit |
| `noUncheckedSideEffectImports` defaults to `true` | not set → becomes true | none expected. `src/` has no bare side-effect imports (all imports bind names) |
| `libReplacement` defaults to `false` | not set | none (no `@typescript/lib-*` packages) |
| `esModuleInterop` / `allowSyntheticDefaultImports` can't be `false` | `"esModuleInterop": true` (:14) | none. Default imports such as `import path from "node:path"` (`src/config.ts:8`) stay valid |
| `moduleResolution node/node10/classic` removed | `Node16` (:5) | none. `node16`/`node18`/`node20`/`nodenext` remain (https://www.typescriptlang.org/tsconfig/module.html) |
| `baseUrl`, `outFile`, `target es5`, `downlevelIteration`, `module amd/umd/system/none`, `alwaysStrict false` removed | none used | none |
| `module Foo {}` namespace syntax and `import … asserts {}` are errors | grep finds no `namespace`/`asserts {` in `src/` | none |
| `tsc file.ts` with a tsconfig present is an error (TS5112) | build uses `tsc -p tsconfig.json` (`package.json:14`) | none |
| 7.0: `stableTypeOrdering` always on; template-literal inference uses code points | | type-check only. Could in theory surface new inference errors. UNVERIFIED until a build runs |
| `lib` changes: `es2025` added; `dom.iterable` merged into `dom` | `"lib": ["ES2023"]` (:6), no DOM | none |

Optional modernisation, not required: TypeScript 5.9 added `module: node20`. It is "a stable option … unlikely to have new behaviors in the future … specifying `--module node20` will imply `--target es2023`", whereas `nodenext` "implies the floating `--target esnext`" (https://devblogs.microsoft.com/typescript/announcing-typescript-5-9/, 2025-08-01). With a Node `>=24` floor, `"module": "node20"` would model Node's `require(esm)` support. The kit does not need that: the bridge is pure ESM (`"type": "module"`, `package.json:5`). Keep `Node16` + `ES2023` to minimise emit churn. Raising `target`/`lib` to ES2024/ES2025 is possible on Node 24, but it is a separate decision that could change `dist/`.

### 3. `@types/node` major for a Node `>=24` floor (CI on 24 and 26)

- Registry facts (https://registry.npmjs.org/@types/node, fetched 2026-11-05): `latest` is 26.6.6 (2026-10-28). The newest 24.x is **24.19.2** (2026-10-09). Both declare `typeScriptVersion: "5.6"` with `typesVersions` only for `<=5.6`/`<=5.7`, so either works with TS 6/7. Today the bridge has `"@types/node": "^26.0.0"` (`package.json:27`, locked 26.5.1 in `bun.lock:21`).
- Why 24: `@types/node` majors mirror Node majors. Typing against 26 lets code compile that calls APIs absent on Node 24, which the `engines` floor would still allow. That error would only show up at runtime on the Node-24 CI leg, or not at all if the path is untested. Typing against the floor turns that into a compile error. This follows the brief's rule (types match the floor), and the Node floor decision is in `research/node-lts.md` (recommends `>=24`, CI on 24 and 26).
- Risk check: the Node APIs in `src/` are `fs.*Sync`, `fs.promises`, `path.*`, `os.homedir`, `process.*`, plus `node:crypto`, `node:child_process` and `node:http` (grep of `src/`). All of them predate Node 20, so `@types/node@24` should compile cleanly. A real compile is needed to confirm.
- Recommended spec: `"@types/node": "^24.19.2"` (caret stays below 25). Also update `engines.node` from `">=20"` (`mcp/zcode-harness-mcp/package.json:11`) to `">=24"` in the same change.

### 4. `@types/bun` pinning (proxy)

- `zcode-proxy-src/package.json:21` has `"@types/bun": "latest"`, resolved in `zcode-proxy-src/bun.lock:18,28` to `@types/bun@1.3.14` / `bun-types@1.3.14`, which is behind the Bun runtime.
- Registry (https://registry.npmjs.org/@types/bun, fetched 2026-11-05): `latest` is 1.4.4 (2026-10-23T00:09Z), and each `@types/bun@X` depends on `bun-types@X` exactly (1.4.0 → bun-types 1.4.0, 1.4.2 → 1.4.2, 1.4.3 → 1.4.3, 1.4.4 → 1.4.4). Since the types version tracks the runtime version, pinning `"@types/bun": "1.4.4"` exactly ties the types to the Bun 1.4.4 runtime pin from `research/bun.md`. A floating `"latest"` cannot do that: the lockfile freezes whatever version happened to be current.
- `zcode-proxy-src/tsconfig.json:10` uses `"types": ["bun-types"]`. That resolves only because `bun-types` is hoisted as a dependency of `@types/bun`. Bun's docs recommend `"types": ["bun"]` for TS 6+ ("If you are using TypeScript 6.0 or later, explicitly include `\"types\": [\"bun\"]`", https://bun.com/docs/runtime/check, accessed 2026-11-05). This is optional but more robust.
- Type checking in the proxy: `bun x tsc --noEmit` has no local `typescript`. "bunx checks for a locally installed package first, then falls back to auto-installing it from npm" (https://bun.com/docs/pm/bunx), and Bun maps `tsc` to `typescript` ("matching the existing `bunx tsc` → `typescript` alias", https://bun.com/blog/bun-v1.3.13, 2026-04-20). So it runs whatever `typescript@latest` is at the time of the run (7.0.2 today, 5.x when the workflow was written). Pin `"typescript": "7.0.2"` as a devDependency, or use `bun check`. Bun 1.4.3 added `bun check`, a port of typescript-go that "aims to report exactly what `tsc` from TypeScript 7 reports" (https://bun.com/blog/bun-v1.4.3, 2026-10-10; https://bun.com/docs/runtime/check). The proxy tsconfig sets `types` (:10) and `rootDir` (:12) explicitly, so the TS 6/7 default changes do not affect it.

### 5. Will committed `dist/` change?

- `mcp/zcode-harness-mcp/dist/**` is tracked in git (`git ls-files dist` lists `dist/index.js`, `dist/config.js`, …).
- `declaration: false` and `sourceMap: false` (:17-18), so only `.js` is emitted. The `@types/node` and `@types/bun` bumps affect type checking only and **cannot** change emit.
- TS 5.9 → 6.0.3: all options whose defaults changed in 6.0 are set explicitly. Expected emit: identical. UNVERIFIED (no build was run, per the brief).
- TS 5.9 → 7.0.2: new emitter, ported "as faithfully as possible, writing new code while maintaining the structure and logic of the original codebase" (7.0 blog). typescript-go's `CHANGES.md` documents intentional output differences only for `.d.ts` emit from `.js` input (https://github.com/microsoft/typescript-go/blob/main/CHANGES.md, accessed 2026-11-05). Neither applies here. Byte-identical JS emit for `.ts` → ES2023 ESM is **UNVERIFIED**.
- Verification step for the implementer: `cd mcp/zcode-harness-mcp && npm run build && git diff --stat dist`, once on 5.9.3 (should be clean, which proves `dist/` is current) and once on 7.0.2. Commit any regenerated `dist/` together with the version bump.

## Sources

- npm registry, `typescript`: https://registry.npmjs.org/typescript (fetched 2026-11-05)
- npm registry, `@typescript/typescript6`: https://registry.npmjs.org/@typescript/typescript6 (fetched 2026-11-05)
- npm registry, `@types/node`: https://registry.npmjs.org/@types/node (fetched 2026-11-05)
- npm registry, `@types/bun`: https://registry.npmjs.org/@types/bun (fetched 2026-11-05)
- npm registry, `tsc` (deprecated stub, 2.0.4, 2022-01-15): https://registry.npmjs.org/tsc (fetched 2026-11-05)
- Announcing TypeScript 7.0, 2026-07-08: https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/
- Announcing TypeScript 7.0 RC, 2026-06-18: https://devblogs.microsoft.com/typescript/announcing-typescript-7-0-rc/
- Announcing TypeScript 7.0 Beta, 2026-04-21: https://devblogs.microsoft.com/typescript/announcing-typescript-7-0-beta/
- Announcing TypeScript 6.0, 2026-03-23: https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/
- TypeScript 6.0 release notes (handbook, undated page, accessed 2026-11-05): https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html
- Announcing TypeScript 5.9, 2025-08-01: https://devblogs.microsoft.com/typescript/announcing-typescript-5-9/
- TSConfig `module` reference (accessed 2026-11-05): https://www.typescriptlang.org/tsconfig/module.html
- typescript-go CHANGES.md (accessed 2026-11-05): https://github.com/microsoft/typescript-go/blob/main/CHANGES.md
- Bun docs, bunx (accessed 2026-11-05): https://bun.com/docs/pm/bunx
- Bun docs, type checking / `bun check` (accessed 2026-11-05): https://bun.com/docs/runtime/check
- Bun v1.3.13 blog, 2026-04-20: https://bun.com/blog/bun-v1.3.13
- Bun v1.4.3 blog, 2026-10-10: https://bun.com/blog/bun-v1.4.3
- Repo: `mcp/zcode-harness-mcp/tsconfig.json:3-20`, `mcp/zcode-harness-mcp/package.json:11,14,27-28`, `mcp/zcode-harness-mcp/bun.lock:21,189`, `zcode-proxy-src/package.json:21`, `zcode-proxy-src/bun.lock:18,28`, `zcode-proxy-src/tsconfig.json:10,12`, `zcode-proxy-src/.github/workflows/ci.yml:41`, `release.yml:58`
