// Real-rspack regression gate for ROOT-ABSOLUTE references (BUGS_TO_FIX §39).
// Chrome resolves a leading `/` from the extension root, so a wild extension
// can point an HTML page at `<script src="/js/popup.js" type="module">` or a
// manifest surface at `options_page: "/page/options.html"`. Two silent holes:
//
//   1. The HTML script-src path copied the module verbatim (correct, the
//      browser resolves it) but DROPPED its static import closure: the
//      `import {msg} from "/js/gr.js"` shipped intact while js/gr.js never
//      landed in dist, and the popup died on the import fetch. Repro:
//      UPSTREAM_BUG_repros/h-root-absolute-html-src (corpus id
//      oa--conmeobeou1253__1.5.7_0).
//
//   2. The manifest overrides treated ANY root-absolute page ref as
//      public-served: the html pipeline compiled /page/options.html to
//      options/index.html while the dist manifest kept pointing at
//      page/options.html, which nothing emitted. The options surface 404'd
//      silently (corpus ids oa--Chimildic__YaMuTools,
//      oa--abalsam__cisco-dialer, the latter proving the `.htm` spelling).

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

const HTML_SRC_ROOT = fs.mkdtempSync(
  path.join(os.tmpdir(), 'extjs-build-root-abs-html-')
)
const OPTIONS_ROOT = fs.mkdtempSync(
  path.join(os.tmpdir(), 'extjs-build-root-abs-options-')
)
const PUBLIC_OPTIONS_ROOT = fs.mkdtempSync(
  path.join(os.tmpdir(), 'extjs-build-root-abs-public-')
)

function writePackageJson(root: string, name: string) {
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name, version: '0.0.0'}, null, 2)
  )
}

// Mirrors UPSTREAM_BUG_repros/h-root-absolute-html-src: a popup page whose
// module script is referenced root-absolutely and imports a sibling the
// bundler never sees.
function writeHtmlSrcFixture() {
  writePackageJson(HTML_SRC_ROOT, 'extjs-build-root-abs-html-spec')
  fs.mkdirSync(path.join(HTML_SRC_ROOT, 'js'), {recursive: true})

  fs.writeFileSync(
    path.join(HTML_SRC_ROOT, 'manifest.json'),
    JSON.stringify(
      {
        manifest_version: 3,
        name: 'Build Spec, root-absolute html src',
        version: '1.0.0',
        action: {default_popup: '/popup.html'}
      },
      null,
      2
    )
  )
  fs.writeFileSync(
    path.join(HTML_SRC_ROOT, 'popup.html'),
    '<!doctype html><html><body><div id="out"></div>' +
      '<script src="/js/popup.js" type="module"></script></body></html>\n'
  )
  fs.writeFileSync(
    path.join(HTML_SRC_ROOT, 'js', 'popup.js'),
    'import { msg } from "/js/gr.js";\n' +
      'document.getElementById("out").textContent = msg;\n'
  )
  fs.writeFileSync(
    path.join(HTML_SRC_ROOT, 'js', 'gr.js'),
    'export const msg = "root-absolute import loaded";\n'
  )
}

// The §39 addendum shape: a root-absolute options_page that lives at the
// project root (NOT under public/), compiled by the html pipeline, so the
// dist manifest must point at the compiled surface.
function writeOptionsFixture() {
  writePackageJson(OPTIONS_ROOT, 'extjs-build-root-abs-options-spec')
  fs.mkdirSync(path.join(OPTIONS_ROOT, 'page'), {recursive: true})

  fs.writeFileSync(
    path.join(OPTIONS_ROOT, 'manifest.json'),
    JSON.stringify(
      {
        manifest_version: 3,
        name: 'Build Spec, root-absolute options_page',
        version: '1.0.0',
        options_page: '/page/options.html'
      },
      null,
      2
    )
  )
  fs.writeFileSync(
    path.join(OPTIONS_ROOT, 'page', 'options.html'),
    '<!doctype html><html><body><h1>opts</h1></body></html>\n'
  )
}

// public/ keeps precedence: a root-absolute ref that public/ owns stays a
// verbatim public path in the manifest, the special-folders pipeline serves
// it at the output root.
function writePublicOptionsFixture() {
  writePackageJson(PUBLIC_OPTIONS_ROOT, 'extjs-build-root-abs-public-spec')
  fs.mkdirSync(path.join(PUBLIC_OPTIONS_ROOT, 'public', 'page'), {
    recursive: true
  })

  fs.writeFileSync(
    path.join(PUBLIC_OPTIONS_ROOT, 'manifest.json'),
    JSON.stringify(
      {
        manifest_version: 3,
        name: 'Build Spec, public root-absolute options_page',
        version: '1.0.0',
        options_page: '/page/options.html'
      },
      null,
      2
    )
  )
  fs.writeFileSync(
    path.join(PUBLIC_OPTIONS_ROOT, 'public', 'page', 'options.html'),
    '<!doctype html><html><body><h1>public opts</h1></body></html>\n'
  )
}

async function buildFixture(root: string) {
  const {extensionBuild} = await import('../command-build')

  const previousVitest = process.env.VITEST
  process.env.VITEST = 'true'

  try {
    return await extensionBuild(root, {
      browser: 'chrome',
      silent: true,
      install: false,
      mode: 'production',
      exitOnError: false
    } as any)
  } finally {
    if (previousVitest === undefined) {
      delete process.env.VITEST
    } else {
      process.env.VITEST = previousVitest
    }
  }
}

beforeAll(() => {
  writeHtmlSrcFixture()
  writeOptionsFixture()
  writePublicOptionsFixture()
}, 30_000)

afterAll(() => {
  fs.rmSync(HTML_SRC_ROOT, {recursive: true, force: true})
  fs.rmSync(OPTIONS_ROOT, {recursive: true, force: true})
  fs.rmSync(PUBLIC_OPTIONS_ROOT, {recursive: true, force: true})
})

describe('build: root-absolute references (real rspack)', () => {
  it('ships the static import closure of a root-absolute html script src', async () => {
    const summary = await buildFixture(HTML_SRC_ROOT)
    expect(summary.errors_count).toBe(0)

    const distDir = path.join(HTML_SRC_ROOT, 'dist', 'chrome')

    // The module ships verbatim (the browser resolves its imports)...
    const popupJs = fs.readFileSync(
      path.join(distDir, 'js', 'popup.js'),
      'utf8'
    )
    expect(popupJs).toContain('from "/js/gr.js"')

    // ...so its import closure must ship beside it.
    const grJs = path.join(distDir, 'js', 'gr.js')
    expect(fs.existsSync(grJs), `missing ${grJs}`).toBe(true)
    expect(fs.readFileSync(grJs, 'utf8')).toContain(
      'root-absolute import loaded'
    )

    // And the ref that ships must not be reported as missing.
    expect(summary.warnings_count ?? 0).toBe(0)
  }, 120_000)

  it('points the dist manifest at the compiled surface for a root-absolute options_page', async () => {
    const summary = await buildFixture(OPTIONS_ROOT)
    expect(summary.errors_count).toBe(0)

    const distDir = path.join(OPTIONS_ROOT, 'dist', 'chrome')
    const manifest = JSON.parse(
      fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8')
    )

    expect(manifest.options_page).toBe('options/index.html')
    expect(fs.existsSync(path.join(distDir, 'options', 'index.html'))).toBe(
      true
    )
  }, 120_000)

  it('keeps public/ precedence for a root-absolute options_page that public owns', async () => {
    const summary = await buildFixture(PUBLIC_OPTIONS_ROOT)
    expect(summary.errors_count).toBe(0)

    const distDir = path.join(PUBLIC_OPTIONS_ROOT, 'dist', 'chrome')
    const manifest = JSON.parse(
      fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8')
    )

    expect(manifest.options_page).toBe('page/options.html')
    expect(fs.existsSync(path.join(distDir, 'page', 'options.html'))).toBe(true)
    expect(
      fs.readFileSync(path.join(distDir, 'page', 'options.html'), 'utf8')
    ).toContain('public opts')
  }, 120_000)
})
