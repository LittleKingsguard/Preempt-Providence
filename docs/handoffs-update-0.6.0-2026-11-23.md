# Update for downstream agents — `provident-ssr@0.6.0` is published

**To:** `Provident-Electron` — and specifically the agents working in that tree · **From:** `Preempt-Providence`
(the `provident-ssr` package) · **Date:** 2026-11-23 · **Re:** the release you are consuming. Everything below is
either a **VERIFIED** fact from this repo/registry or a **DIRECTIVE**; the contracts themselves are cited, never
restated — do not copy a rule out of this file into code comments or your own specs.

## 0 · The release, verified

| Fact | Value |
| --- | --- |
| Version | **`0.6.0`** (`dist-tags.latest = 0.6.0`) |
| Published | **2026-11-23T15:09:25.979Z** |
| Tarball | `https://registry.npmjs.org/provident-ssr/-/provident-ssr-0.6.0.tgz` |
| shasum | **`6dfa85fd2c80dffc64606a24b67872eda96f348a`** — identical to the pre-flight `npm pack --dry-run`, so the published artefact is byte-reproducible from the tagged commit |
| Tag | `v0.6.0` (annotated object `ee7da92b06558514c17bdbaacc1ff1cdd4da32e0`) on commit `b8b710c4f048419a87fc34256dc9ca07bbe681f2` |
| Contents | **by reference only** — `docs/releases.md`'s 0.6.0 row, whose items (1)–(12) each name the owning gate record / decision row |

## 1 · HOST-VISIBLE — you MUST handle these

These change what your host receives or must do. Each names its authority; read that, not this list.

1. **A failed condensed-base restore now reports `'no-op'` and KEEPS the graph.** Before, any restore failure was
   silent total loss (`allNodes()` emptied, `status: 'applied'`, no diagnostic). Now: the restore is pre-flighted
   *before* the eviction, exactly one diagnostic is emitted (`restore-refused-no-hub:`, `restore-refused-invalid-snapshot:`,
   or `restore-failed:`), and `replay().status` is `'no-op'`. **A refused replay does NOT re-apply the post-base journal
   entries** (the graph is at its pre-base state; re-applying would double-apply a `rows-mint`).
   → *Authority:* `docs/decisions.md` **`RESTORE-REFUSES-NOT-EMPTIES`**; `docs/specs/undo-redo-report.md` **U19**.
   → *Directive:* **branch on `replay().status`.** If you treat every replay as `'applied'`, you will believe a
   refused restore succeeded.
2. **A mutated condensed base now warns once — and still restores.** `condense()` digests the base; a restore past a
   base whose recorded carriers were rewritten emits exactly one `restore-base-mutated: …` per base marker and then
   restores the rewritten state. `status` stays **`'applied'`**.
   → *Authority:* `docs/decisions.md` **`CONDENSE-BASE-IS-A-LIVE-VIEW`** clause (2); gate
   `docs/specs/restore-base-mutation-detection-gate-review.md`.
   → *Directive:* **do not branch on `status` for this one** — the warn is the only signal, and its absence is not
   proof that history is intact (coverage is the snapshot's by-reference carriers only).
3. **The condensed base is a LIVE VIEW, not a detached snapshot.** It shares `content`, nested `props`, anchor
   `value`, `derived`, `bodyRuns`, batch `rows` and `css.cssDef` objects with your live graph.
   → *Directive (the big one):* **never hold references to graph objects across a condense**, and never write through
   one. Mutating a captured object in place **rewrites recorded history** — unsupported behaviour, deliberately not
   prevented. An untouched restore hands back the **same** objects, so **never test for object freshness** either.
   → Also: `targetProp` is `props.${string}` with a **single** segment — `'props.theme.mode'` writes a LITERAL key
   `"theme.mode"` and does not traverse. To change a nested value, write the **whole carrier**
   (`targetProp: 'props.theme'`, full object). Reaching into the object you already hold is the one path that rewrites
   history. *Authority:* `docs/specs/serialize.md` (document contract), `docs/specs/api.md` (`LayerMutation`),
   `docs/skills/designing-pages.md` §5.4.
4. **`attach` now registers an unregistered node.** It used to be a silent no-op that still reported
   `{status:'applied', dirtied:[id]}` — nothing rendered. → *Directive:* if you have code that relied on attach being
   inert for a node you never registered, it will now attach and render. *Authority:* `docs/specs/ops.md` §2.1.
5. **A handler with an event and no body now warns** (`handler-body-missing`) and **still emits its `on:<event>`
   listener** — the markup advertises a control that can never run. → *Directive:* install a closure for **every**
   authored handler key; never infer "wired" from your own markup. *Authority:* `docs/defects.md`
   `HANDLER-BODYLESS-SILENT-DEAD`.
6. **A condensed base now ships every node id once.** A page whose def is seam-wired
   (`component: [{ target: 'children', reference: <def> }]`) used to ship that node twice and its restore was
   **refused**; it restores normally now. → *Directive:* after a restore, the def-root/def-child come back
   **registry-only** (the pinned live shape) and re-wire on compile, so **`allNodes()` may be SMALLER after a restore
   than before it. That is not a loss.** *Authority:* `docs/defects.md` `CONDENSE-CENSUS-NO-DEDUPE`;
   `docs/specs/serialize.md` (census contract).

## 2 · MAY NOTICE — graded changes, not regressions

- **Emitted element/state counts drop for routed grafts.** The `E5` mint removal takes one element/state per
  placement path, and the node's `state` event / `resolvedStates` count drops by one. *Authority:*
  `docs/specs/orphan-emit-gate-review.md`, `docs/decisions.md` `PATH-DOMAIN-RE-MINT`.
- **New diagnostic classes.** `unresolved-reference` on the path channels, and the compile-mode-mismatch line when
  `'path'` mode is declared over a family bootstrap (refused loudly, owner ruling 3).
- **`isContentRoot?: true` is a new PUBLIC shape** on the serialized node state (`SerializedRenderDoc`): emitted only
  when true, advisory on restore. If you validate or fingerprint snapshot documents, admit the field.
- **`journalEntries()` / `JournalView` are unchanged** (`{index, kind, status}` only) — no snapshot, no hash leaks.

## 3 · Upgrade checklist for your agents

1. Pin **`provident-ssr@0.6.0`**; confirm `npm ls provident-ssr` shows it and the shasum above if you vendor the tarball.
2. Grep your host for **references held across a condense** (`maxJournalLength` / any `replay()` call site) — remove
   them or re-read from the graph afterwards.
3. Grep for **`replay()` call sites that do not inspect `.status`** — add a `'no-op'` branch.
4. Grep for **in-place writes into `props` / `content` / anchor `value`** outside `apply(...)` — they are the
   history-rewriting path. Replace them with a whole-carrier `state-slice`.
5. Grep for **dotted `props.a.b` writes** expecting traversal — they land as literal keys.
6. Grep for **`allNodes()` counts compared across a restore** — the def prototypes are registry-only afterwards.
7. Re-run your own validation trio against 0.6.0 and keep your `H-1`/`H-2` dispositions as answered
   (`docs/handoffs-answer-modularity-2026-11-23.md`).

## 4 · What is NOT in this release — do not plan around these

Unchanged, documented residuals; **none is a shipping defect**, each has a row:

- `R-VPD-1`, `R-VPD-2`, `R-VPD-4` — provider-read order dependence, the ghost `childOrder` wire, the FS-1
  `dropped`-completeness debt. *(`docs/defects.md`)*
- **`ORPHAN-EMIT-TOP-LEVEL-LEAK` — family mode only.** A `placement-attach` into a container that is not
  placement-routed still emits a **detached top-level sibling** in `family` mode; `path` mode appends correctly.
  → *Directive:* if you graft into a non-routed container, use `path` mode or expect the orphan.
- `GRAFT-RESIDUALS` (a) — graft-into-graft still collapses onto one key.
- `PATH-MODE-DIAGNOSTIC-UNGUARDED`, `COMPILE-MODE-OVERRIDE-ORDERING`, the silent `chosen` prune.
- The **pass-2 performance residual** (no guard is red; the growth guard has margin).

## 5 · Where the authority lives

`docs/releases.md` (the index row — contents by reference) → its owning records: `docs/decisions.md` (the pinned
contracts), `docs/specs/*.md` (the behaviour contracts) and the `*-gate-review.md` records (the adjudications),
`docs/defects.md` (the state of every known defect, FIXED or OPEN), `docs/skills/designing-pages.md` (the author-facing
rules, §5.1–§5.4 and §11–§12). If this summary and any of those disagree, **the records win** and this file is the bug.
