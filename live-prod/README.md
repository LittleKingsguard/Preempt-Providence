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
