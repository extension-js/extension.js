// Reload-matrix scenarios.
//
// Each row is one ground-truth assertion about the dev pipeline. The harness
// runs the row and the matrix runner compares observed vs. expected. The
// expectations are written from the user's perspective: "for save X, the
// user extension's SW should restart Y times and its pages should reload Z
// times". Companion-extension noise is filtered out at classification time.
//
// We deliberately keep expectations slightly loose where Chrome's behavior
// is non-deterministic (e.g. SW idle restarts on a fresh profile). Where
// the matrix sees an upper bound rather than an exact count, the row uses
// `serviceWorkerRestartsAtMost` instead of `serviceWorkerRestarts`.

import {join, resolve} from 'node:path'

const REPO_ROOT = resolve(new URL('../..', import.meta.url).pathname)
const FIX_ACTION_LOCALES = join(REPO_ROOT, '_FUTURE/examples/examples/action-locales')
const FIX_ACTION = join(REPO_ROOT, '_FUTURE/examples/examples/action')

export const SCENARIOS = [
  {
    name: 'locales-single-edit-popup-closed',
    fixturePath: FIX_ACTION_LOCALES,
    openPages: [],
    edits: [
      {
        relativePath: '_locales/en/messages.json',
        transform: (s) =>
          s.replace(
            /"message":\s*"Welcome[^"]*"/,
            '"message": "Welcome (matrix run)"'
          ),
        waitMsAfter: 200
      }
    ],
    expected: {
      serviceWorkerRestarts: 1,
      extensionPageNavigations: 0
    }
  },
  {
    name: 'locales-single-edit-popup-open',
    fixturePath: FIX_ACTION_LOCALES,
    openPages: ['action/index.html'],
    edits: [
      {
        relativePath: '_locales/en/messages.json',
        transform: (s) =>
          s.replace(
            /"message":\s*"Welcome[^"]*"/,
            '"message": "Welcome (matrix run popup-open)"'
          ),
        waitMsAfter: 200
      }
    ],
    // The popup is a chrome-extension:// page; the extension reload tears it
    // down. From the user's perspective that is one navigation event for the
    // popup, plus one SW restart for the extension.
    expected: {
      serviceWorkerRestarts: 1,
      extensionPageNavigationsAtMost: 1
    }
  },
  {
    name: 'locales-rapid-edits-popup-closed',
    fixturePath: FIX_ACTION_LOCALES,
    openPages: [],
    edits: [
      {
        relativePath: '_locales/en/messages.json',
        transform: (s) =>
          s.replace(
            /"message":\s*"Welcome[^"]*"/,
            '"message": "Welcome (rapid 1)"'
          ),
        waitMsAfter: 80
      },
      {
        relativePath: '_locales/en/messages.json',
        transform: (s) =>
          s.replace(
            /"message":\s*"Welcome[^"]*"/,
            '"message": "Welcome (rapid 2)"'
          ),
        waitMsAfter: 80
      },
      {
        relativePath: '_locales/en/messages.json',
        transform: (s) =>
          s.replace(
            /"message":\s*"Welcome[^"]*"/,
            '"message": "Welcome (rapid 3)"'
          ),
        waitMsAfter: 80
      }
    ],
    // The watcher's polling + aggregateTimeout collapses the burst; we expect
    // 1 or 2 SW restarts, never 3.
    expected: {
      serviceWorkerRestartsAtMost: 2,
      extensionPageNavigations: 0
    }
  },
  {
    name: 'manifest-edit-popup-closed',
    fixturePath: FIX_ACTION_LOCALES,
    openPages: [],
    edits: [
      {
        relativePath: 'src/manifest.json',
        transform: (s) =>
          s.replace(
            /"description":\s*"[^"]*"/,
            '"description": "Matrix-run description bump"'
          ),
        waitMsAfter: 200
      }
    ],
    expected: {
      serviceWorkerRestarts: 1,
      extensionPageNavigations: 0
    }
  },
  {
    name: 'popup-html-edit-popup-open',
    fixturePath: FIX_ACTION,
    openPages: ['action/index.html'],
    edits: [
      {
        relativePath: 'src/action/index.html',
        // Append a comment node so the file mtime changes without breaking
        // the page. Plain whitespace appends are sometimes optimized away.
        transform: (s) => s + `\n<!-- matrix-run ${Date.now()} -->\n`,
        waitMsAfter: 200
      }
    ],
    // Editing a popup page should NOT restart the SW. It SHOULD navigate the
    // open popup (livereload broadcast / HMR fallback) — but not multiple
    // times in a row.
    expected: {
      serviceWorkerRestartsAtMost: 0,
      extensionPageNavigationsAtMost: 1
    }
  }
]
