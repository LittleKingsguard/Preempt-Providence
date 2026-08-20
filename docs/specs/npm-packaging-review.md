# npm Import-Module Packaging — Requirements Review (2026-08-20)

Status: REVIEW of what is missing to ship `provident-ssr` as an npm
import module (the engine library; the product surface is `src/core/*` per
`docs/specs/contract.md` §"public API surface"). No package.json/tsconfig
changed by this review — the fix shape below is ready to execute on the user
go-ahead. Companion context: `package.json`, `tsconfig.json`,
`tsconfig.demo.json`, `.gitignore`, `docs/specs/contract.md`.

## 1. What the package IS

The engine is a zero-dependency ESM library: `translateLegacy`/`reverseTranslate`
(legacy envelope in/out), `Node`/`Supervisor` (graph + managed channel),
`dispatchEvent`/`dispatchPhase` (handlers), `diffMinimal`/`emitElements`/
`applyOps`/`treeFromOps`/`treeSig` (render), `DomAdapter`/`SSRFragmentAdapter`
(concrete adapters), `serializeSlice`/`loadState` (SSR doc), `EventBridge`,
`createClient`, payload/validation ops. The demos import it as `dist/core/*`
(`import { translateLegacy } from '../dist/core/translate.js'`) — the exact
consumer pattern an npm package must serve. **There is no server** (no
`src/index.ts`, no `src/server.ts`; the `start`/`dev` scripts point at
nonexistent files) — this is a library, not an app.

## 2. Current state (facts)

| Item | State |
| --- | --- |
| `private` | `"private": true` — npm publish BLOCKED |
| entry points | none — no `main`/`module`/`types`/`exports`; no `src/index.ts` |
| `files` | none (would ship the whole repo incl. tests/demo/scripts/docs) |
| build layout | TWO overlapping outputs: `dist/core/*` (tsconfig.demo.json, rootDir `src`, `declaration: false`) AND `dist/src/core/*` + `dist/tests/*` (tsconfig.json, rootDir `.`, WITH `.d.ts`). Neither is publishable as-is |
| types | no `types`/`exports["."].types`; the `.d.ts` live only under `dist/src` + `dist/tests` (wrong layout, tests included) |
| dependencies | `ws@^8.18.0` is the ONLY dependency and is NOT imported anywhere in `src/` (stale) |
| module system | ESM-only (`"type": "module"`, `.js`-suffixed relative imports) — good; no CJS |
| environment | core has NO Node builtins at module scope; the only global is `document` guarded (`typeof document === 'undefined'` in `DomAdapter` constructor) — imports are environment-agnostic (Node + browser bundler) |
| license | `LICENSE` = AGPL-3.0 (in-repo); no `"license"` field |
| engines | none |

## 3. Missing requirements (the gap list)

### R1 — publishability + metadata
- Remove `"private": true` (or use `"private": false` / a scope).
- Add `"license": "AGPL-3.0"`, `"repository"`, `"author"`, `"description"`
  (currently "Skeleton server…" — reword to the engine library), `"keywords"`.
- **Licensing note:** AGPL-3.0 is a copyleft network license — a published
  package carries source-disclosure obligations for network consumers.
  Confirm the license is intended before any public publish (no change to the
  license itself is made here).

### R2 — entry point + exports map + types
- Add `src/index.ts` — the barrel re-exporting the canonical public surface
  from contract.md (translateLegacy, reverseTranslate, Node, Supervisor,
  dispatchEvent, dispatchPhase, dispatchPhaseForNodes, makeHandlerContext,
  diffMinimal, MockAdapter, emitElements, applyOps, treeFromOps, treeSig,
  wireKey, jsonClone, DomAdapter, SSRFragmentAdapter, VOID_TAGS,
  serializeSlice, loadState, EventBridge, createClient, mintNodeId,
  reconcileParentTargets, payload ops, validation, and the key types).
- Add an `exports` map (Node ESM + bundlers, `.js`-suffixed module resolution
  already in place):

```jsonc
"exports": {
  ".": {
    "types": "./dist/core/index.d.ts",
    "import": "./dist/core/index.js"
  },
  "./core/*": {
    "types": "./dist/core/*.d.ts",
    "import": "./dist/core/*.js"
  },
  "./package.json": "./package.json"
}
```
  The `./core/*` subpath keeps the power-user direct-module surface (the demo
  pattern) while `.` is the ergonomic barrel. ESM-only means NO dual-package
  hazard (record as a decision — no CJS build; `main` omitted so tooling falls
  through to `exports`).

### R3 — a single publishable build layout
- Add `tsconfig.build.json`:
```jsonc
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["tests", "demo", "scripts"]
}
```
  → emits `dist/core/*.js` + `dist/core/*.d.ts` (the demo layout, WITH types),
  no `dist/src`/`dist/tests`. Repoint `"build"` to it.

### R4 — files whitelist + prepack
- `"files": ["dist"]` (npm auto-includes package.json/README/LICENSE).
  Excludes tests/demo/scripts/docs/src — a consumer never needs them.
- `"prepack": "npm run build"` so `npm publish` always ships fresh dist
  (dist/ is gitignored — it must be produced at pack time).

### R5 — dependency hygiene
- Drop the unused `ws` dependency (core is zero-dependency; nothing imports
  it). Keep `ws` only if a future `src/server.ts` uses it — as of now it is
  dead weight on a published install.

### R6 — environment + engines + side effects
- `"engines": { "node": ">=16" }` (ES2022 target; `queueMicrotask` +
  `performance.now` used by supervisor). `"sideEffects": false` (core modules
  are import-pure — module-level counters/maps are internal state, safe for
  tree-shaking).
- Verify the emitted `.d.ts` reference only `./x.js` specifiers (they do) and
  never `@types/node` types (the core surface is DOM/browser-safe at import;
  `DomAdapter` throws only on construction without `document` — a documented
  runtime gate, not an import-time failure).

### R7 — consumer documentation
- A consumer README section (current README has none): install,
  `import { translateLegacy, Supervisor } from 'provident-ssr'`, a
  minimal translate→compile→render example, and the `preempt-providence/core/*`
  subpath escape hatch. The `docs/specs/*.md` stay in-repo (not shipped);
  the published package needs a compact usage doc.

### R8 — versioning / publish mechanics
- `"version": "0.1.0"` is pre-1.0 — fine for an initial publish; record the
  registry (public vs scoped), `npm publish --access public` for an unscoped
  name, and a `publishConfig` block if needed.

## 4. Recommended package.json delta (the fix shape)

```jsonc
{
  "name": "provident-ssr",
  "version": "0.1.0",
  "description": "The Preempt-Providence reactive render engine — legacy-envelope translate, anchor-graph Supervisor, handlers, SSR/DOM render adapters.",
  "license": "AGPL-3.0",
  "type": "module",
  "main": "./dist/core/index.js",
  "types": "./dist/core/index.d.ts",
  "exports": {
    ".": { "types": "./dist/core/index.d.ts", "import": "./dist/core/index.js" },
    "./core/*": { "types": "./dist/core/*.d.ts", "import": "./dist/core/*.js" },
    "./package.json": "./package.json"
  },
  "files": ["dist"],
  "sideEffects": false,
  "engines": { "node": ">=16" },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "prepack": "npm run build",
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {}
}
```

## 5. Cost / benefit

- **Cost:** one barrel file, one build tsconfig, a package.json delta, a README
  section, and dropping an unused dep. No engine change, no API change (the
  surface is already documented in contract.md and already consumed via
  `dist/core/*`).
- **Benefit:** `npm install provident-ssr` → `import { translateLegacy,
  Supervisor, emitElements } from 'provident-ssr'` (+ the `core/*` escape
  hatch); types resolve; tree-shakeable; environment-agnostic; no runtime
  deps. The demo/test/spec surface stays private.
- **Non-goals (recorded):** no CJS build (ESM-only decision — avoids the dual
  hazard); no server entry (no `src/server.ts` today — a future server, if
  any, would be a separate entry); no bundler-specific conditions yet (the
  core is import-safe without a `"browser"` condition).

## 6. Verdict

**REQUIREMENTS IDENTIFIED — READY TO EXECUTE.** The package is a thin
packaging layer over an already-clean, already-consumed `dist/core/*` surface;
nothing in the engine needs to change. Execute on the user go-ahead: add
`src/index.ts`, `tsconfig.build.json`, apply the package.json delta (R1–R6),
write the README usage section (R7), and verify with a `npm pack --dry-run`
(then the trio). Record the ESM-only + zero-dependency + AGPL decisions in
`docs/decisions.md` on landing.
