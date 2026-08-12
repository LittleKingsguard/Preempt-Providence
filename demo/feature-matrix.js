/**
 * Feature-matrix browser page — every framework surface in one document.
 *
 * Thin wrapper over the shared harness (demo/lib/feature-matrix-tests.js);
 * the checks themselves live in the harness so the mode-toggle page
 * (SSR / client / markdown adapter modes) can drive the exact same surface.
 */
import { runFeatureMatrixTests } from './lib/feature-matrix-tests.js'

const initialData = JSON.parse(document.getElementById('preempt-initial-data').textContent)
const serverData = JSON.parse(document.getElementById('server-data').textContent)

runFeatureMatrixTests({
  appEl: document.getElementById('app'),
  resultsEl: document.getElementById('results'),
  serverDocEl: document.getElementById('server-doc'),
  initialData,
  serverData,
  title: 'Feature Matrix',
})
