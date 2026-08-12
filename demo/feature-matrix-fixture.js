/**
 * Feature-matrix demo fixture — the single document that exercises every
 * advertised framework surface in one page:
 *
 *   placements (content/comments zones), components (session + theme forks),
 *   event + phase handlers (session populate, markdown render), managed
 *   updates (ClientAPI.apply), in-place render with focus retention,
 *   payload lifecycle (drop/refresh/append), reverse translation,
 *   loop-safety (circular-source arm drop), SSR-parity data.
 *
 * The graph is built FROM the legacy envelope via `translateLegacy` (the real
 * boundary), then completed with the two things the boundary does not create:
 *   1. component SOURCE anchors (session/theme/loop providers) — legacy data
 *      only ever declares `target` (consumer) anchors;
 *   2. placement attachment — content roots are placed into their zones by
 *      adding parent-child anchors on the zones' family links (the explicit
 *      placement step; unplaced content stays out of the tree by design).
 */
import { translateLegacy } from '../dist/core/translate.js'
import { addComponentSource } from './demo-fixtures.js'

/** Corrected legacy envelope driving the page (authoring notes in the
 *  template's doc block explain the corrections vs the first draft). */
export const demoData = {
  template: {
    root: {
      type: 'app',
      props: { id: 'app-root' },
      css: { id: 'preempt-app' },
      children: [
        {
          type: 'header',
          props: { id: 'app-header' },
          children: [
            { type: 'span', content: 'Feature Matrix', props: { id: 'title' } },
            {
              // user pane — consumes the 'session' component (target anchor).
              // The pane's after-compile handler (installed at runtime; bodies
              // are not serializable) populates the username descendant from
              // the resolved session record. Classes match demo.css's
              // `.user-pane` styles (same convention as the components demo).
              type: 'div',
              props: { id: 'user-pane' },
              css: { classes: ['user-pane'] },
              component: { reference: 'session' },
              children: [
                { type: 'span', props: { id: 'username' }, css: { classes: ['username'] }, content: 'anonymous' },
                { type: 'button', props: { id: 'login-btn' }, css: { classes: ['login-btn'] }, content: 'Login' },
                { type: 'button', props: { id: 'logout-btn' }, css: { classes: ['logout-btn'] }, content: 'Logout' },
              ],
            },
          ],
        },
        {
          // markdown editor → display (in-place render, focus retention).
          // The display's after-compile handler parses `**bold**` into the
          // structured parts below; typing re-diffs IN PLACE (set-only ops on
          // the SAME element objects ⇒ no focus loss).
          type: 'section',
          props: { id: 'editor-block' },
          children: [
            { type: 'textarea', props: { id: 'md-editor', value: 'Type **bold** here' }, css: { classes: ['editor'] } },
            {
              type: 'div',
              props: { id: 'md-display' },
              css: { classes: ['display'] },
              children: [
                { type: 'span', props: { id: 'md-prefix' }, content: '' },
                { type: 'strong', props: { id: 'md-bold' }, content: '' },
                { type: 'span', props: { id: 'md-suffix' }, content: '' },
              ],
            },
          ],
        },
        {
          // content zone — receives the 'content' payload roots (attached at
          // build, refreshed at runtime).
          type: 'main',
          props: { id: 'content-zone' },
          css: { classes: ['zone'] },
          children: [],
        },
        {
          // comments zone — receives the 'comments' payload roots; the page
          // then exercises append / drop against this zone. Dropping is
          // USER-TRIGGERED via the "Drop comments" button below (P-4 drop
          // semantics), not automatic.
          type: 'aside',
          props: { id: 'comments-zone' },
          css: { classes: ['zone'] },
          children: [],
        },
        {
          // payload controls — the drop button drives dropPayload on click
          // (handler wired client-side, like the session buttons).
          type: 'section',
          props: { id: 'payload-controls' },
          children: [
            {
              type: 'button',
              props: { id: 'drop-comments-btn' },
              css: { classes: ['drop-comments-btn'] },
              content: 'Drop comments',
            },
          ],
        },
        {
          // fork demo — fork-a and fork-b both consume 'theme'; root provides
          // it twice ⇒ each consumer resolves TWO actionable arms (FRK-H2).
          // Classes match demo.css: the section is the flex row, each consumer
          // (and therefore each of its arms) is a styled arm card.
          type: 'section',
          props: { id: 'fork-demo' },
          css: { classes: ['fork-arms'] },
          children: [
            { type: 'div', component: { reference: 'theme' }, props: { id: 'fork-a' }, css: { classes: ['arm-card'] } },
            { type: 'div', component: { reference: 'theme' }, props: { id: 'fork-b' }, css: { classes: ['arm-card'] } },
          ],
        },
        {
          // loop probe — an ANCESTRY resolution cycle (loop-cycle ⇄ loop-nest
          // each source the name the other targets): the borrow walk revisits
          // a node ⇒ the arm is dropped with reason 'loop' + a
          // 'circular-source' warning (S-R2.5 / F11). The section, its sibling
          // note, and the plain survivor below still render (pipeline survives;
          // the looped arm is the only thing dropped — FRK-F3 sibling arms
          // unaffected).
          type: 'section',
          props: { id: 'loop-probe' },
          children: [
            { type: 'p', props: { id: 'loop-note' }, content: 'Loop probe — circular-source arm dropped; sibling content below survives:' },
            {
              type: 'div',
              props: { id: 'loop-cycle' },
              component: { reference: 'circ-a' },
              children: [
                {
                  type: 'div',
                  props: { id: 'loop-nest' },
                  component: { reference: 'circ-b' },
                  children: [
                    { type: 'span', props: { id: 'loop-a' }, component: { reference: 'circ-a' }, content: 'a' },
                  ],
                },
                { type: 'span', props: { id: 'loop-b' }, component: { reference: 'circ-b' }, content: 'b' },
              ],
            },
            { type: 'p', props: { id: 'loop-survivor' }, content: 'Survivor: a plain sibling with no component reference — it renders while the looped arm above is dropped.' },
          ],
        },
      ],
    },
    // root-level component binding → target anchor on the root (a consumer).
    // The provider is a harness-added SOURCE anchor (legacy data cannot
    // express providers).
    component: { reference: 'session', value: { user: 'ada', role: 'admin' } },
  },
  // unplaced content payloads — placed into their zones by the harness.
  content: [
    {
      metadata: { title: 'Demo payload' },
      content: [
        {
          type: 'article',
          props: { id: 'article-1' },
          placement: { placementName: 'content' },
          content: 'Preempt renders placements, components, and handlers.',
        },
        {
          type: 'p',
          props: { id: 'article-tagline' },
          placement: { placementName: 'content' },
          content: 'Payload-owned content persists while unplaced (P-4).',
        },
      ],
    },
    {
      metadata: { title: 'Comments payload' },
      content: [
        {
          type: 'p',
          props: { id: 'comment-1' },
          placement: { placementName: 'comments' },
          content: 'First comment.',
        },
      ],
    },
  ],
  clientConfig: { runInstantiation: false, runMonitoring: true },
}

function attach(parent, child, priority) {
  child.addAnchor('child', child, { priority }, parent.familyLinkFor())
}

/** Build the full graph: translate → providers → placement attach. */
export function buildFeatureMatrix() {
  const t = translateLegacy(demoData)
  const byId = new Map()
  for (const n of t.nodes) byId.set(n.props?.id, n)
  const root = t.root

  // component SOURCES (providers) — legacy data only declares consumers.
  addComponentSource(root, 'session', { user: 'ada', role: 'admin' })
  addComponentSource(root, 'theme', 'theme: dark')
  addComponentSource(root, 'theme', 'theme: light')
  addComponentSource(byId.get('loop-cycle'), 'circ-b', '→')
  addComponentSource(byId.get('loop-nest'), 'circ-a', '→')

  // placement attach: content roots into their zones (explicit attach step).
  const contentZone = byId.get('content-zone')
  const commentsZone = byId.get('comments-zone')
  const article1 = byId.get('article-1')
  const tagline = byId.get('article-tagline')
  const comment1 = byId.get('comment-1')
  attach(contentZone, article1, 0)
  attach(contentZone, tagline, 1)
  attach(commentsZone, comment1, 0)

  const labels = {}
  for (const n of t.nodes) {
    if (typeof n.props?.id === 'string') {
      labels[n.id] = { name: n.props.id, type: n.type }
    }
  }

  return {
    root,
    nodes: t.nodes,
    content: t.content,
    byId,
    zone: { content: contentZone, comments: commentsZone },
    payloadGroups: { article: [article1, tagline], comments: [comment1] },
    labels,
    clientConfig: t.clientConfig,
  }
}
