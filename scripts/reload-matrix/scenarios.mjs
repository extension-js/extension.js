// Reload-matrix scenarios.
//
// Each row is one ground-truth assertion about the dev pipeline. The harness
// runs the row and the matrix runner compares observed vs. expected.
//
// Expectations are written from the user's perspective: "for save X, the
// user extension's SW should restart Y times and its pages should reload Z
// times". Companion-extension noise is filtered out at classification time.
//
// The rows here are the executable counterpart of `_FUTURE/examples/RELOAD_MATRIX.md`,
// which documents the expected outcome per template × surface. Each cell in
// that doc maps to one row below; when the doc and the runtime diverge, the
// matrix flips to FAIL and surfaces the specific cell.
//
// Where Chrome's behavior is non-deterministic (e.g. SW idle restarts on a
// fresh profile under memory pressure), the row uses `serviceWorkerRestartsAtMost`
// instead of `serviceWorkerRestarts`. We default to exact counts unless the
// surface is documented as ambiguous.

import {resolveTemplateFixture} from './harness.mjs'

/**
 * Helper: replace any string field's value matching `searchPattern` with
 * `replacement`. Used to make controlled, harmless edits to fixture files
 * without rewriting them wholesale.
 */
function regexReplace(searchPattern, replacement) {
  return (current) => current.replace(searchPattern, replacement)
}

/**
 * Append a comment to a file so its mtime changes without breaking the
 * file. Used for HTML / config files where any whitespace edit is fine but
 * the watcher needs a real content delta.
 */
function appendComment(commentText) {
  return (current) =>
    `${current}\n<!-- reload-matrix: ${commentText} ${Date.now()} -->\n`
}

const ACTION_LOCALES = resolveTemplateFixture('action-locales')
const ACTION = resolveTemplateFixture('action')

export const SCENARIOS = [
  // ---------------------------------------------------------------------------
  // _locales / message catalog edits
  // ---------------------------------------------------------------------------
  {
    name: 'locales-single-edit-popup-closed',
    fixturePath: ACTION_LOCALES,
    openPages: [],
    edits: [
      {
        relativePath: '_locales/en/messages.json',
        transform: regexReplace(
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
    fixturePath: ACTION_LOCALES,
    openPages: ['action/index.html'],
    edits: [
      {
        relativePath: '_locales/en/messages.json',
        transform: regexReplace(
          /"message":\s*"Welcome[^"]*"/,
          '"message": "Welcome (matrix run popup-open)"'
        ),
        waitMsAfter: 200
      }
    ],
    // The popup is a chrome-extension:// page; the extension reload tears it
    // down. From CDP that's one navigation event for the popup, plus one SW
    // restart for the extension.
    expected: {
      serviceWorkerRestarts: 1,
      extensionPageNavigationsAtMost: 1
    }
  },
  {
    name: 'locales-rapid-edits-popup-closed',
    fixturePath: ACTION_LOCALES,
    openPages: [],
    edits: [
      {
        relativePath: '_locales/en/messages.json',
        transform: regexReplace(
          /"message":\s*"Welcome[^"]*"/,
          '"message": "Welcome (rapid 1)"'
        ),
        waitMsAfter: 80
      },
      {
        relativePath: '_locales/en/messages.json',
        transform: regexReplace(
          /"message":\s*"Welcome[^"]*"/,
          '"message": "Welcome (rapid 2)"'
        ),
        waitMsAfter: 80
      },
      {
        relativePath: '_locales/en/messages.json',
        transform: regexReplace(
          /"message":\s*"Welcome[^"]*"/,
          '"message": "Welcome (rapid 3)"'
        ),
        waitMsAfter: 80
      }
    ],
    // Polling watcher + aggregateTimeout collapse the burst; we expect
    // 1 or 2 SW restarts, never 3.
    expected: {
      serviceWorkerRestartsAtMost: 2,
      extensionPageNavigations: 0
    }
  },

  // ---------------------------------------------------------------------------
  // manifest.json edits
  // ---------------------------------------------------------------------------
  {
    name: 'manifest-edit-popup-closed',
    fixturePath: ACTION_LOCALES,
    openPages: [],
    edits: [
      {
        relativePath: 'src/manifest.json',
        transform: regexReplace(
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

  // ---------------------------------------------------------------------------
  // Page-only edits (popup HTML/JS/CSS) on a non-content-script extension.
  // These should NOT restart the SW — the dev-server's livereload broadcast
  // refreshes the open page on its own.
  // ---------------------------------------------------------------------------
  {
    name: 'popup-html-edit-popup-open',
    fixturePath: ACTION,
    openPages: ['action/index.html'],
    edits: [
      {
        relativePath: 'src/action/index.html',
        transform: appendComment('popup-html-edit'),
        waitMsAfter: 200
      }
    ],
    expected: {
      serviceWorkerRestartsAtMost: 0,
      extensionPageNavigationsAtMost: 1
    }
  },
  {
    name: 'popup-html-edit-popup-closed',
    fixturePath: ACTION,
    openPages: [],
    edits: [
      {
        relativePath: 'src/action/index.html',
        transform: appendComment('popup-html-edit-no-popup'),
        waitMsAfter: 200
      }
    ],
    // No popup open = nothing to refresh. The SW must NOT restart; the
    // updated bundle is on disk for the next time the user opens the popup.
    expected: {
      serviceWorkerRestartsAtMost: 0,
      extensionPageNavigationsAtMost: 0
    }
  }
]
