import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vm from 'node:vm'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

// A page entry is its scripts plus its linked stylesheets in one import list.
// rspack 2.2.4 to 2.2.6 drop the stylesheet's module factory from the page
// bundle and keep its startup call, so every page with a <link> stylesheet
// threw "e[n] is not a function" on load. The bundler is pinned to an exact
// version for that reason, and this executes a built page to prove the shape.
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-build-html-css-'))

function writeFixture() {
  fs.writeFileSync(
    path.join(ROOT, 'package.json'),
    JSON.stringify(
      {private: true, name: 'extjs-build-html-css-spec', version: '0.0.0'},
      null,
      2
    )
  )

  fs.writeFileSync(
    path.join(ROOT, 'manifest.json'),
    JSON.stringify(
      {
        manifest_version: 3,
        name: 'Build Spec, HTML page with a linked stylesheet',
        version: '1.0.0',
        action: {default_popup: 'popup.html'}
      },
      null,
      2
    )
  )

  fs.writeFileSync(
    path.join(ROOT, 'popup.html'),
    [
      '<html><head>',
      '<link rel="stylesheet" href="./styles.css" />',
      '</head><body>',
      '<script type="module" src="./popup.js"></script>',
      '</body></html>',
      ''
    ].join('\n')
  )

  fs.writeFileSync(path.join(ROOT, 'styles.css'), 'body { color: red; }\n')

  fs.writeFileSync(
    path.join(ROOT, 'popup.js'),
    'import "./extra.css"\ndocument.title = "page ran";\n'
  )

  fs.writeFileSync(path.join(ROOT, 'extra.css'), 'h1 { margin: 0; }\n')
}

async function buildFixture() {
  const {extensionBuild} = await import('../command-build')

  const previousAuthorMode = process.env.EXTENSION_AUTHOR_MODE
  const previousVitest = process.env.VITEST
  process.env.VITEST = 'true'
  delete process.env.EXTENSION_AUTHOR_MODE

  try {
    return await extensionBuild(ROOT, {
      browser: 'chrome',
      silent: true,
      install: false,
      mode: 'production',
      exitOnError: false
    } as any)
  } finally {
    if (previousAuthorMode === undefined) {
      delete process.env.EXTENSION_AUTHOR_MODE
    } else {
      process.env.EXTENSION_AUTHOR_MODE = previousAuthorMode
    }

    if (previousVitest === undefined) {
      delete process.env.VITEST
    } else {
      process.env.VITEST = previousVitest
    }
  }
}

beforeAll(() => {
  writeFixture()
}, 30_000)

afterAll(() => {
  fs.rmSync(ROOT, {recursive: true, force: true})
})

describe('build: HTML page with a linked stylesheet (real rspack)', () => {
  it('emits a page bundle whose startup only calls modules it defines', async () => {
    const summary = await buildFixture()
    expect(summary.errors_count).toBe(0)

    const distDir = path.join(ROOT, 'dist', 'chrome', 'action')
    const bundlePath = path.join(distDir, 'index.js')
    expect(fs.existsSync(bundlePath), `missing ${bundlePath}`).toBe(true)

    const css = fs.readFileSync(path.join(distDir, 'index.css'), 'utf8')
    expect(css).toContain('color')
    expect(css).toContain('margin')

    const context = vm.createContext({document: {title: ''}, console})
    const run = () =>
      vm.runInContext(fs.readFileSync(bundlePath, 'utf8'), context, {
        filename: 'action/index.js'
      })

    // The failing shape threw after the page's own module ran, so the title
    // alone would not catch it. The run itself has to be clean.
    expect(run).not.toThrow()
    expect((context as any).document.title).toBe('page ran')
  }, 120_000)

  it('keeps @rspack/core pinned to an exact version', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')
    )
    const range = packageJson.dependencies['@rspack/core']

    expect(
      range,
      '@rspack/core must be an exact version: 2.2.4 to 2.2.6 break every page ' +
        'with a linked stylesheet, and a range lets a user install a version ' +
        'no CI lane has built with'
    ).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
