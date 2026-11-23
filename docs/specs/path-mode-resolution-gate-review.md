# Path-mode resolution — Q4 gate (three-agent review)

**STATUS: DECIDED — (C) record repair. The resolution half is CLOSED; the loud half ships as landed.**
Gate provenance: three-agent gate (AGENTS.md item 9) — step 1 validity and step 2 critique ran independently
and read-only, neither reading the other; step 3 change-analysis adjudicated both and re-read every decisive
claim at `8bcd0b7`. Date: 2026-11-23.

**The proposal under gate:** `PATH-MODE-SILENT-UNRESOLVED`'s *resolution half* — a family-chain consumer under
R-1's `path` compile mode loses a binding provided by a **descendant** (measured, probe P-7 arms A1/A2/A5:
`family` binds `theme:'dark'`, `path` yields `bindings {}` + one `unresolved` entry).

**Candidates:** **(A)** `compilePath` gains an optional slice/bounds argument and a family-chain walk resolves
over the family universe while the state stays path-keyed; **(B)** the supervisor routes family-chain members
through `node.compile(slice)` in path mode; **(C)** leave the code and repair the record.

---

## 1. Feasibility

**(A) NOT VIABLE — it splits one state across two edge relations.** A path state's `pathKey` / `trace` /
`parent` / `children` all come from **the walk** (which traverses the seam-resolving `stateChildAnchor`,
`node.ts:135`); `bindings` would come from the **family** relation (which traverses `familyChildAnchors`,
`resolve.ts:233`, `:237`). The licence for the whole identity scheme is stated verbatim at `resolve.ts:271-274`
— *"identical ancestor trees ⇒ identical bindings, which is why identity = pathKey alone"* — so (A) **falsifies
the premise and keeps the conclusion**.

Three constructions, all legal today, all break it:
- **C1 (the default configuration).** Dirty a **sibling** of the provider: `focusedSliceFor` never sweeps the
  provider universe when `hubAnswers` is true (`supervisor.ts:64-88`, short-circuit `:71-78`) and
  `translateLegacy` **defaults to a hub** (`translate.ts:1138`), so the provider is out of slice; path mode
  re-mints **every** member (`:787-796`, `:613-624`), so the consumer's payload becomes a function of **event
  history** on an unchanged graph — and silent, because the warn dedup is a module-level set never cleared
  (`node.ts:404-429`) and the per-path event fires only for the dirty node's own states (`supervisor.ts:808-810`).
  It also breaks P-7's own **A2 ≡ A4** property.
- **C2 (cross-path binder).** A descendant whose family walk would `term`-drop the arm (chain token `component`,
  `resolve.ts:148-156`, `:187-189`) would, under (A), supply a binding to a consumer whose element lives under
  **another container's wire** — the exact hazard Q8 was written to forbid.
- **C3 (the fork).** Two providers (one descendant, one ancestor): nearest-wins silently **drops the family arm**
  (so (A) does not restore "the family walk" at all), or arms the state ⇒ `#f:` in the key ⇒ `isPathState`
  false (`render-helpers.ts:131-133`) ⇒ the wire flips to `nodeId` — the domain flip `POST-BOOTSTRAP-EMIT-DROP`
  exists to prevent.

Plus: **S2 parity's quantifier has no `viable`/`kinds` in the path scope** (path viability is the walk terminal
`node.ts:1521-1528`; family viability is the Phase-A–C classifier `:1171-1221`, `:1263`, and they disagree — a
childless node is family-viable as `slice-root` but path-dropped as `no-edge`), so (A) needs a **second
viability classifier** or produces phantom bindings; it is exactly the "Node-side rule" the R-1 gate record
already refused (`post-bootstrap-emit-drop-fix-review.md:206`, `:222`); an optional argument leaves it **inert at
bootstrap** (~60 no-arg `compilePath()` sites) and disagreeing with pass-2, a mandatory one breaks `types.ts`;
and its cost is **O(Σ_dirty |S|²)** per tick which **re-buys the scan R1 paid 258 ms to remove**, landing in **the
one compile mode with no asserted guard** (the growth guard's pages bootstrap `family`; the derived pages pin
per-region values and run one enumeration pass with zero flush yields).

**(B) FATAL.** `compile()` is **whole-slice** (`node.ts:1346-1367`, `:1263`), so routing one member through it
mints family states for **all** members; the root is family-chain **by the carve-out's own words**, so it flips
to its `nodeId` wire and the never-reset `rootKey` (`adapters.ts:463`, `:572-573`) zeroes the document —
`POST-BOOTSTRAP-EMIT-DROP` re-shipped by its own fix.

**(C) VIABLE — and the carve-out is FALSE as an implementation claim.** `mintPathState` calls
`resolvePathTargets` **unconditionally**, with no family-chain branch (`node.ts:1600`), and that resolver has
**no descendant arm** (`resolve.ts:279-302`); the only "family walk" in the engine is family **mode**
(`compile()` → `resolveArms`). So Q8's sentence — *"The family walk remains only for states whose path IS the
family chain (non-placement states)"* (`placement-path-spec.md:986-992`) — describes **nothing that exists.**

## 2. What each report got right

| | |
| --- | --- |
| Step 1 right on | Q8 **is** violated, for the whole ordinary tree (predicate = `walk.hops.every(h => h.zone === undefined)`; `firstHopZone` is **not** it, so `activePlacement` cannot be reused); (B) fatal; (C) viable/moot; and the (c2) ambiguity in Q8's own sentence. |
| Step 1 wrong on | (A) "zero identity change" — field-disjointness does not license a second edge relation under a path-keyed identity. |
| Step 2 right on | (A)'s incoherence (C1/C2/C3), its cost, and that the carve-out describes nothing that exists. |

## 3. Disposition

1. **`placement-path-spec` §9 Q8** — replace the carve-out sentence with the true clause: *path-only resolution
   applies to **every** path-state, including one whose walk **is** the family chain; the family walk exists only
   in the `family` mode* — with the descendant restriction stated as the contract's price, the two remedies
   (invert the provider/consumer direction, or bootstrap in family mode), and the **(c2)** ruling (a routed graft
   whose placement walks are all non-viable keeps its zero-hop token walk via the last-state guard: that is a
   **path-state**, not a family-chain state, and it resolves path-only).
2. **`docs/decisions.md`** — one ACTIVE row `PATH-MODE-RESOLUTION-UNIVERSE`, recording that the refusal is on
   **identity grounds** (`resolve.ts:271-274`), not merely "not built".
3. **`docs/defects.md`** — `PATH-MODE-SILENT-UNRESOLVED` **closes both halves** (loud landed; resolution half =
   documented restriction, not a defect). A new OPEN row `PATH-MODE-DIAGNOSTIC-UNGUARDED` carries the honesty
   cost: the diagnostic is deduped by a never-cleared module set (per-process, unrepeatable) and **no guard reads
   either channel**.
4. **`docs/pending.md`** — the Q4 stance row **closes**; the override arm (A5: `setCompileMode('path')` over a
   family bootstrap silently deletes an emitted binding) is re-filed as its own small ruling.
5. **`docs/skills/designing-pages.md`** — the author-facing rule: in `path` mode a consumer cannot read a value
   provided by its own descendant.

**SURVIVING GUARANTEE:** a path-state's bindings are a **pure function of its path tree** — deterministic,
slice-independent, `A2 ≡ A4`.
**WEAKNESSES, stated in the same breath:** a descendant provider is **not resolvable in `path` mode**; the only
diagnostic is a **per-process-deduped `console.warn` + `CompiledState.unresolved`**, and **no guard reads
either** (the new OPEN row).
**VERSION CLASS: PATCH** — docs + tracker correction; the diagnostic already landed. No wire, type or semantics
change.

## 4. Narrower forms of (A) — all closed

- **Root-only** — no: the root is a slice member via the ancestor closure (`supervisor.ts:54`) and is re-minted
  while its descendant provider is out of slice (`:71-78` + `translate.ts:1138`) ⇒ the same C1 stripping.
- **Provider-guaranteed-in-slice** — no: slice membership is a function of the *dirty* node, not the consumer;
  that is C1 by definition.
- **A tree-level descendant index (slice-independent)** — coherent on determinism, closed on everything else: new
  persistent structure invalidated on every op (negating the R1 slice work, `supervisor.ts:44-50`), still needs
  the second viability classifier and the multi-provider/`term` rule, and it re-introduces the cross-path binder
  Q8 forbids. If descendant resolution is ever wanted, the honest shape is a **page-data** remedy (invert the
  relation for that reference class), not engine work.

## 5. Rulings requested of the owner

1. **Ratify the Q8 amendment** (the carve-out sentence is factually false; the repair is a correction, not a new
   policy).
2. **Ratify the (c2) sentence** (the routed graft whose placement walks are all non-viable keeps its zero-hop
   token walk; that state is a path-state, not a family-chain state).
3. **The compile-mode override** — `setCompileMode('path')` over a family bootstrap silently deletes an emitted
   binding (arm A5): **forbid it** (documented as unsupported) or make it **refuse loudly**? One-line ruling.
