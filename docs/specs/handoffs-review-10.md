# Astrographer Handoff — Three-Agent Gate + Executor Contract

**Status:** **LANDED (2026-09-12, target 0.4.1 defect patch).** PROCEED-AS-RESHAPED —
three verified package defects, all implemented via the TDD trio. Full validation
trio green: 1286 tests (11 new), typecheck clean, `demo:smoke` SMOKE OK (fork-stress
pins within the 2.5× guard), build clean. Source: `Astrographer/docs/HANDOFF.md` (the
consumer catalogue, 2026-09-11, against `provident-ssr@0.4.0`). Gate provenance:
three-agent gate (AGENTS.md item 9) — step 1 validity, step 2 critique, step 3
change-analysis — plus a code verification pass against the current engine.
Date: 2026-09-12.

This record is the gate verdict AND the executor contract for the three items
that survived verification. The other handoff rows are dispositions, not fixes:
**ENG-INLINE-ORDER** (resolved 0.4.0, wording corrected), **ENG-BODYRUNS-WIRE-REF**
(resolved 0.3.1), **ENG-BODYRUNS-WIRE-REF-PATHSTATE** (upstream-gated 2026-08-31;
def-fill fixed 0.3.2, placement-sibling widening REJECTED/parked; host-moot since
0.4.0 — reclassified, not an open request), **ENG-GAP-1** (shelved, rationale
sound).

---

## 1. What the handoff asks

An Astrographer → provident handoff listing engine/foundation gaps. Verification
against `provident-ssr@0.4.0` confirms exactly THREE genuine, current engine
defects (two newly identified by the consumer, one latent residue it surfaced):

1. **HOST/U1-ENG (high)** — `DomAdapter.setProp` has no boolean-attribute
   special-case: `checked`/`selected: false` routes to the generic `else` and
   `bakeValue(false)` → `'false'`, so `setAttribute('checked', 'false')` leaves
   the boolean attribute PRESENT. A radio/select cannot render an unchecked state
   through the prop path. (`adapters.ts:248-256` DOM, `:459-463` SSR;
   `bakeValue` `render-helpers.ts:82-85`.)
2. **ENG-SUPERVISOR-HOOK-ACCUMULATION (medium)** — every `new Supervisor`
   registers a MODULE-LEVEL `onNodeFinalized` hook (`registry.ts:387-389`,
   `supervisor.ts:180-185`) that is never deregistered; a discarded Supervisor
   (and its node map) is retained forever. No `dispose()` exists.
3. **ENG-DESTROY-PLACEMENT-ANCHOR-RESIDUE (low, latent)** — `Node.destroyLinks`
   (`node.ts:852-861`) dissolves only `child`-role anchors; `content`/`container`
   placement anchors survive destroy. On a persistent hub (a reused placement
   Link) each destroyed root leaves a stale anchor.

The handoff's own "proposed shape" for (1) offered a host-side post-render fix
OR an engine boolean-attribute opt-in. The host-side fix is rejected here (it
patches the consumer, not the foundation, and cannot serve SSR); the engine
boolean-attribute opt-in is the adopted shape. For (2)/(3) the handoff's proposed
shapes are adopted essentially as stated.

## 2. Step 1 — validity (summary)

- **(1) VIABLE.** The gap is reproduced: no boolean branch exists in either
  adapter; `bakeValue(false) === 'false'`; `setAttribute` with any string
  (including `'false'`) leaves an HTML boolean attribute present. An engine set
  of boolean-attribute names routed to presence/removal fixes DOM and SSR with
  one seam. No dependency missing.
- **(2) VIABLE.** `onNodeFinalized` is the only registrar and returns `void`;
  making it return an unsubscribe is a source-compatible widening. `Supervisor`
  has the exact register site (constructor) and the maps to release
  (`nodes`, `destroyedRefs`, `pass2Dirty`).
- **(3) VIABLE-WITH-RESHAPE.** `destroyLinks` must NOT call `link.destroy()` for
  content/container anchors — a placement Link is SHARED per name across
  producers/consumers, so destroying it would dissolve OTHER nodes' anchors. The
  correct dissolve is `Node.removeAnchor` (`node.ts:935-941`: removes from both
  `this.anchors` and the per-name Link). The reshaped fix is per-anchor detach,
  not link destruction.

## 3. Step 2 — critique (summary)

- **(1)** Boolean-attribute reflection is browser-native semantics; the only
  hazards are (a) over-broad truthiness (a `'false'` STRING must not count as
  present — the helper must treat it false) and (b) accidentally matching a
  non-boolean attr named `value`/`download`. Mitigations: a closed boolean set +
  an explicit falsy set. Non-breaking: previously such props were strings; only
  `false`-ish values change behavior (the broken case).
- **(2)** Disposal must be idempotent and must not remove another Supervisor's
  hook (the unsubscribe closes over its OWN hook). Clearing the maps is
  enough; the shared sweep timer is module-level and untouched.
- **(3)** Detaching the destroyed node's placement anchors has a real side
  effect: a consumer's `content` anchor no longer resolves a container once its
  producer is destroyed — which is the intended semantics (the handoff observed
  no re-render of a destroyed node). The cascade's placement-owned-child
  exemption (`registry.ts:409` `isPlacementOwned`) is about which children
  SURVIVE the parent's destroy, not about the parent's own anchors, so it is
  unaffected. Scope is limited to `content`/`container` (component/source/duplex
  anchors are untouched — a separate latent question, not this defect).

## 4. Step 3 — change-analysis verdict

**PROCEED.** All three are genuine, low-risk, non-breaking foundation defects.
Costs are small and localized; benefits are correctness for any boolean-form
consumer, bounded memory for Supervisor rotation, and no stale placement state
on a reused hub. No better alternative for (1) exists engine-side; the host-side
workaround is lower quality and does not serve SSR.

---

## 5. Executor contract

### 5.1 HOST/U1-ENG — boolean-attribute support in both adapters

- Add a module-level closed set `BOOLEAN_ATTRS` in `src/core/adapters.ts`:
  `allowfullscreen, async, autofocus, autoplay, checked, controls, default,
  defer, disabled, formnovalidate, hidden, inert, ismap, itemscope, loop,
  multiple, muted, nomodule, novalidate, open, playsinline, readonly, required,
  reversed, selected, truespeed, typemustmatch` (`download` is NOT boolean).
- Add helper `booleanAttrValue(v): boolean` — **false** for
  `undefined | null | false | 0 | '0' | 'false' | ''`; **true** otherwise.
- **DOM `setProp` generic `else` branch** (`adapters.ts:248-256`), before the
  `value`/`VALUE_FORMS` case: when `BOOLEAN_ATTRS.has(attr)` —
  - `on = booleanAttrValue(val)`;
  - `on ? el.setAttribute(attr, bakeValue(val)) : el.removeAttribute(attr)`
    (ON keeps the authored string form — `hidden="true"` is the existing pin;
    OFF removes the attribute, so `checked="false"` is gone);
  - if the element exposes a boolean property of that name
    (`typeof (el as Record<string, unknown>)[attr] === 'boolean'`), reflect it
    (`el[attr] = on`) so `checked`/`selected`/`disabled`/`multiple` form state is
    correct even when the property was previously dirtied;
  - `return` (never `bakeValue` a boolean attribute to `'false'`).
- **SSR `setProp` generic `else` branch** (`adapters.ts:459-463`): when
  `BOOLEAN_ATTRS.has(attr)` — `on ? state.attrs.set(attr, escapeAttr(val)) :
  state.attrs.delete(attr)` (ON keeps the authored string form; OFF is absent —
  never `checked="false"`).
- All other attrs keep the existing `escapeAttr`/`setAttribute` path.

### 5.2 ENG-SUPERVISOR-HOOK-ACCUMULATION — `Supervisor.dispose()`

- `registry.ts`: `onNodeFinalized(hook): () => void` returns an unsubscribe that
  splices `hook` out of `finalizeHooks` (idempotent). Add an exported
  `finalizeHookCount(): number` diagnostic (mirrors `findElScanCount`).
- `supervisor.ts`: store the returned unsubscribe; add
  `dispose(): void` that (a) calls the unsubscribe (idempotent — null it after),
  (b) clears `this.nodes`, `this.destroyedRefs`, and `this.pass2Dirty`.
- No change to the module-level sweep timer or to other Supervisors.

### 5.3 ENG-DESTROY-PLACEMENT-ANCHOR-RESIDUE — destroy dissolves placement anchors

- `node.ts` `destroyLinks()`: iterate a copy of `this.anchors`; keep the existing
  `child` handling (`linkOf(a).destroy()`); for `a.role === 'content' ||
  a.role === 'container'` call `this.removeAnchor(a)` (per-anchor detach via the
  shared per-name Link — NEVER `link.destroy()`). Keep the existing
  `markPending` condition (`dissolved || this.childAnchor() === null`).
- Component/source/duplex anchors are unchanged (out of scope).

---

## 6. TDD red set (tests before implementation)

`tests/unit/boolean-attrs.test.ts` (new):
1. DOM `prop:checked` false → `el.checked === false` and attribute absent; true →
   attribute present + `el.checked === true`.
2. DOM `prop:selected` false on `option` → unselected; `prop:disabled` false/true.
3. DOM non-boolean `prop:value` false → unchanged existing path (no boolean
   treatment).
4. `checked: 'false'` (string) → treated false (unchecked).
5. SSR boolean false omits the attr (no `checked="false"`); true emits presence.

`tests/unit/supervisor-dispose.test.ts` (new):
6. `onNodeFinalized` returns an unsubscribe; after unsubscribe the hook no longer
   fires; unsubscribe is idempotent.
7. `finalizeHookCount()` returns to baseline after `new Supervisor` → `dispose()`.
8. `dispose()` clears `getNode`/`allNodes` and is idempotent (double-dispose does
   not throw and does not remove another Supervisor's hook).

`tests/unit/destroy-placement-anchor.test.ts` (new):
9. A node with a `container` anchor → destroy → the per-name placement Link no
   longer holds that anchor AND `node.anchors` no longer holds it.
10. A node with `content` anchors → destroy → the shared Link retains only the
    OTHER nodes' anchors (a sibling consumer's anchor survives).
11. Destroy a producer with two consumers: producer's container anchor gone, both
    consumers' content anchors intact.

Green: implement §5, run the full validation trio (AGENTS.md item 4) +
`npm run build`.

## 7. Tracker impact

- `docs/defects.md` — three NEW open rows (HOST/U1-ENG, ENG-SUPERVISOR-HOOK-
  ACCUMULATION, ENG-DESTROY-PLACEMENT-ANCHOR-RESIDUE) → move to FIXED after the
  TDD trio.
- `docs/decisions.md` — three decision rows (boolean attrs, Supervisor disposal,
  destroy placement dissolve).
- `docs/specs/adapters.md` — a boolean-attribute pin (`setProp` dispatch table).
- No new public surface beyond `onNodeFinalized`'s returned unsubscribe +
  `finalizeHookCount()` + `Supervisor.dispose()`.
