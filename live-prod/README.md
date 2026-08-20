# live-prod — live production example payloads (NOT tracked)

Drop REAL production legacy envelopes here — one directory per source app
(`<app>/initial-data.json`), plus an optional paired `<app>/<page>.html` snapshot
of the page those payloads produce.

## What goes in here

- `initial-data.json` — the **legacy NodeSchema envelope** exactly as the
  production page ships it: `{ template, content, clientConfig: { adapter,
  persistence } }`, the same shape `translateLegacy` consumes (docs/specs/
  translate.md, api.md). Component/placement config, handlers (as function
  STRING bodies where the source provides them), `run*` gates — nothing
  re-expressed, nothing cleaned up: this is the un-sanitized real input.
- `<page>.html` (optional) — the rendered page those payloads produce, for
  visual/intended-vs-actual comparison after running the engine over the
  envelope.

## What they are used for

Live-input testing: run the real envelopes through the engine (translate →
register → compile → emit) to catch data shapes the demos never exercise.
Treat any oddity as a data-authoring lesson (fix the data or the doc) unless
the engine genuinely mis-handles the shape (report as a defect — do not edit
engine code here).

## Rules

- **NEVER commit anything in this directory.** The `live-prod/` dir is
  gitignored (`.gitignore`), so only this README is tracked. Production
  payloads are private data — keep them out of the repository and out of
  commit messages.
- Nothing here participates in `npm run build`, `demo:build`, `demo:smoke`,
  or the test suite.
- Sanitize (or keep local-only) any payload containing secrets.

## Test renderer (untracked by design)

`render-mock.mjs` lives HERE (inside gitignored `live-prod/`, not in
`scripts/`) so it is never part of the tracked repo — run it only on the
machine that holds the private payloads.

```
npm run build                          # fresh dist (imports dist/src/core/*)
node live-prod/render-mock.mjs         # render every mock
node live-prod/render-mock.mjs Logged-inLanding --adapted
```

- Default mode renders each `<app>/<page>.json` envelope AS SHIPPED and writes
  a standalone, browser-viewable `<page>.rendered.html` (engine census in the
  meta bar + the emitted tree with cssDef rules, classes and inline styles) —
  intended-vs-actual comparison against the captured `<page>.html`.
- `--adapted` additionally writes `<page>.adapted.html` with the root-level
  named component seams swapped `content` → `children` — the SEEDING that
  reproduces the DEFECT #24 def-internal drop-zone topology (the wrapped
  adminLinks/contributorLinks nav segments); this exercises the placed-packet-
  in-def-child render (P-EMIT-8/10 chains, docs/defects.md DEFECT #24 + its
  follow-up). Non-envelope JSON dumps inside a mock dir are reported as
  SKIPPED, never as failures.
- The meta bar's **unattached-wires** count is the placement/def-fill test
  signal: > 0 means compiled elements never attached to any parent.

Known observation surfaced by the renderer (adapted mode): the real crafted
links (`adminDashboardLink`/`editContentLink`/`createArticleLink` wrappers —
a `div` whose `target: 'type'` collapses to a def) NEST under their zones after
the DEFECT #24-follow-up chain fix; the collapsed `<a>` initially also lost the
def's `content`/`props` (only type + css surfaced) — **FIXED 2026-08-19**
(OPEN/FIXED DEFECT #25 in `docs/defects.md`; both SED-1 collapse branches now
surface def content + props, pinned by P-EMIT-11).
