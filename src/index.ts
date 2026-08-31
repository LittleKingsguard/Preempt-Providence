/**
 * provident-ssr — public entry (npm import module).
 *
 * Re-exports the canonical `src/core` surface (docs/specs/contract.md
 * §"public API surface"). ESM-only; every import specifier keeps the `.js`
 * extension (the Node ESM contract). Direct per-module access stays available
 * via the `provident-ssr/core/*` subpath export.
 */
// ---- translate (legacy envelope in/out) ----------------------------------
export { translateLegacy, reverseTranslate, kebabKey, serializeStyle, parseStyle, createLinkHub } from './core/translate.js'
export type {
  LegacyInitialData,
  LegacyNodeData,
  LegacyComponentBinding,
  LegacyTemplateData,
  LegacyContentPayload,
  LegacyClientConfig,
  LegacyHandlerDef,
  LegacyPlacementConfig,
  TranslatedTree,
  TranslatedWarning,
  ReverseTranslateOptions,
} from './core/translate.js'

// ---- graph + managed channel ----------------------------------------------
export { Node, mintNodeId, findCycle, reconcileParentTargets, ancestorConsumesZone } from './core/node.js'
export { Supervisor, focusedSliceFor } from './core/supervisor.js'
export type { JournalEntry } from './core/supervisor.js'

// ---- handlers + legacy bridge ----------------------------------------------
export { dispatchEvent, dispatchPhase, dispatchPhaseForNodes, makeHandlerContext } from './core/handlers.js'
export type { HandlerContext, HandlerResult, HandlerPhase } from './core/handlers.js'
export { getNodeView, wrapLegacyHandler, eventStub, legacyContext } from './core/legacy-handlers.js'
export type { LegacyNodeView, LegacyContext, LegacyQuery, NodeViewServices } from './core/legacy-handlers.js'

// ---- render + adapters + helpers --------------------------------------------
export { diffMinimal, MockAdapter } from './core/render.js'
export type { RenderAdapter, RenderOp, MinimalElement, ForkPathKey } from './core/render.js'
export { emitElements, applyOps, minimalFromState, treeFromOps, treeSig, jsonClone, wireKey, renderProducingProcess, encodeRuns, decodeRuns, isBodyEncoded } from './core/render-helpers.js'
export type { MinimalElementSource, RenderTree, RenderOptions, BodyRun } from './core/render-helpers.js'
export { DomAdapter, SSRFragmentAdapter, MarkdownAdapter, VOID_TAGS } from './core/adapters.js'
export type { FragmentDescriptor, DomAdapterOptions } from './core/adapters.js'

// ---- serialization / events / client / payload / validation -----------------
export { serializeNode, serializeSlice, loadState, reRegisterDefPrototypes } from './core/serialize.js'
export type { SerializedRenderDoc, SerializedAnchor, RenderNodeState } from './core/serialize.js'
export { EventBridge, coalesceByTick } from './core/events.js'
export type { EventEnvelope, PreemptEvent } from './core/events.js'
export { createClient } from './core/client.js'
export type { ClientAPI, ExposedState, CompileStatus, ApplyResponse } from './core/client.js'
export { dropPayload, refreshPayload, appendToPayload, nextPriority } from './core/payload.js'
export type { Payload } from './core/payload.js'
export { registerTagSchema, validateNode, TAG_SCHEMAS } from './core/validation.js'
export type { TagSchema } from './core/validation.js'

// ---- link / constants / errors / derived / debug ----------------------------
export { Link, mintLinkId, DEFAULT_PARENT_CHILD, DEFAULT_COMPONENT, DEFAULT_PLACEMENT } from './core/link.js'
export { MAX_COMPILE_DEPTH } from './core/constants.js'
export { LinkConfigError, SingleParentError, CycleError, PipelineError, PipelineLockError, ApplyError } from './core/errors.js'
export { applyDerived, validateDerived, evaluateDerived } from './core/derived.js'
export { setCompilePassLogging, compilePassLogEnabled } from './core/debug.js'

// ---- the shared types (the contract surface) --------------------------------
export type {
  Role,
  AnchorTarget,
  Anchor,
  AnchorOptions,
  NodeState,
  LinkConfig,
  LinkConfigErrorCode,
  NodeId,
  PathKey,
  NodeRef,
  LinkId,
  Actor,
  StructuralOp,
  LayerMutation,
  LayerMutationList,
  StateSliceOp,
  MutationOp,
  NodeBaseData,
  CompiledState,
  DerivedExpr,
  DerivedDecl,
  LinkConfigNameHub,
} from './core/types.js'
