e2e test suites (docs/subagents.md Step 7).

Written:

- `ssr-render.test.ts` — data client/SSR receive → complete render:
  SSR-H1 server doc + client re-render structural parity (PAR-5);
  SSR-H2 hydrate via the `css.id` seam; SSR-H3/SR-F1 client re-resolution
  from anchors (shipped forks never trusted); placements + components + nested.
- `loop-safety.test.ts` — loop-safety probes: A→B→A anchor circles
  (op-time `cycle-detected` rejection + compile-time loop drop with
  `circular-source` warning), component self-reference (depth-0 resolve,
  never loops), dangling source/target (unresolved-reference warning, own
  state still renders; prototype-only candidates drop silently), deep
  acyclic chains compile actionable (depth is not a loop signal — only
  genuine revisits drop as loop), single-parent enforcement.
- `legacy-bootstrap.test.ts` — original backend NodeSchema JSON →
  `translateLegacy` → complete render (in-tree parts render, unplaced
  content stays out), placement attachment, handler-driven managed update
  re-render, new-format boundary round-trip (PAR-5).
- `component-handler.test.ts` — a component provides the source for an
  after-compile handler (user-info panel): resolution carries the handler;
  logged-in populates the username descendant, logged-out shows the login
  button; descendants re-render with the corrected data; diff re-render
  never rebuilds elements.
- `markdown-display.test.ts` — in-place render behavior: typing updates the
  editor source; the display's after-compile handler parses `**bold**` into
  structured nodes; LOCAL and PARENT changes update state via `set` ops
  only — element identity is preserved across renders (no replacement ⇒ no
  focus loss).
- `payload-refresh.test.ts` — payload lifecycle end-to-end: translate →
  render → place → user edit → websocket append → article refresh →
  in-place re-render (only changed wires) → `reverseTranslate` to backend
  format with live state.
