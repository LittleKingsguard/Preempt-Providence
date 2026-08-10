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
  state still renders; prototype-only candidates drop silently), depth-cap
  trip, single-parent enforcement.
