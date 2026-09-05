import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

// A stylesheet the parser rejects ships as authored with one warning in
// development. Production must keep every rule development keeps: the
// minimizer may not drop a sheet, or half of one, that the browser accepts.
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

const CASES = {
  'unclosed-at-rule':
    '.keep-a { color: red }\n@media (max-width: 600px {\n.keep-b { color: blue }\n}\n.keep-c { color: green }\n',
  'unterminated-string':
    '.keep-a { color: red }\n.keep-b { content: "unterminated; }\n.keep-c { color: green }\n'
}

// A sheet whose only fault is an @import after other rules. Browsers skip
// that one rule and apply the rest, so the build keeps every rule too.
const LATE_IMPORT_CSS =
  '.keep-a { color: red }\n@import "./theme.css";\n.keep-b { color: blue }\n.keep-c { color: green }\n'

interface ProjectOptions {
  // Where the sheet is used: a manifest content script, or an html page
  // that links it and so emits a real stylesheet.
  surface?: 'content' | 'page'
  // A postcss config plus the dependency, so the chain runs postcss-loader
  // with the parse guard pitched ahead of it.
  postcss?: boolean
}

function project(css: string, options: ProjectOptions = {}) {
  const {surface = 'content', postcss = false} = options
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-css-parity-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      private: true,
      name: 'parity',
      version: '0.0.0',
      ...(postcss ? {devDependencies: {postcss: '^8.0.0'}} : {})
    })
  )
  if (postcss) {
    fs.writeFileSync(
      path.join(root, 'postcss.config.js'),
      'module.exports = {plugins: []}\n'
    )
  }
  fs.writeFileSync(path.join(root, 'theme.css'), '.theme { color: pink }\n')
  fs.writeFileSync(path.join(root, 'bg.png'), 'PNGDATA\n')
  const manifest: Record<string, unknown> = {
    manifest_version: 3,
    name: 'parity',
    version: '1.0.0'
  }
  if (surface === 'page') {
    fs.writeFileSync(
      path.join(root, 'options.html'),
      '<!doctype html><html><head>\n<link rel="stylesheet" href="./options.css">\n</head><body><h1>options</h1></body></html>\n'
    )
    fs.writeFileSync(path.join(root, 'options.css'), css)
    manifest.options_page = 'options.html'
  } else {
    fs.writeFileSync(path.join(root, 'content.js'), 'console.log("cs")\n')
    fs.writeFileSync(path.join(root, 'content.css'), css)
    manifest.content_scripts = [
      {matches: ['<all_urls>'], js: ['content.js'], css: ['content.css']}
    ]
  }
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest))
  return root
}

async function build(root: string, mode: 'development' | 'production') {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'
  let summary: Awaited<ReturnType<typeof extensionBuild>>
  try {
    summary = await extensionBuild(root, {
      browser: 'chrome',
      silent: true,
      install: false,
      mode,
      exitOnError: false
    } as any)
    expect(summary.errors_count).toBe(0)
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
  const distDir = path.join(root, 'dist', 'chrome')
  // Windows lists nested entries with backslashes; the assertions join posix.
  const files = fs
    .readdirSync(distDir, {recursive: true})
    .map((file) => String(file).split(path.sep).join('/'))
  const text = files
    .filter((file) => file.endsWith('.css') || file.endsWith('.js'))
    .map((file) => fs.readFileSync(path.join(distDir, file), 'utf8'))
    .join('\n')
  return {files, text, summary}
}

const rulesIn = (text: string) =>
  ['keep-a', 'keep-b', 'keep-c'].filter((name) => text.includes(name))

describe('a sheet the parser rejects still ships what it references', () => {
  it('emits the @import target and the url() image beside the shipped sheet', async () => {
    const built = await build(
      project(
        '@import "./theme.css";\n.keep-a { background: url(./bg.png) }\n.keep-b { content: "unterminated; }\n'
      ),
      'production'
    )
    const sheet = built.files.find(
      (file) => file.endsWith('.css') && !file.endsWith('theme.css')
    )
    expect(sheet, built.files.join(',')).toBeDefined()
    const dir = path.posix.dirname(String(sheet))
    expect(built.files).toContain(path.posix.join(dir, 'theme.css'))
    expect(built.files).toContain(path.posix.join(dir, 'bg.png'))
    expect(built.text).toContain('keep-b')
  }, 180_000)
})

describe('production keeps every rule development keeps for an unparseable sheet', () => {
  for (const [name, css] of Object.entries(CASES)) {
    it(name, async () => {
      const dev = await build(project(css), 'development')
      const prod = await build(project(css), 'production')
      expect(
        rulesIn(dev.text).length,
        `dev keeps ${rulesIn(dev.text)}`
      ).toBeGreaterThan(0)
      expect(rulesIn(prod.text), `${name}: prod vs dev`).toEqual(
        rulesIn(dev.text)
      )
    }, 180_000)
  }
})

// The misplaced @import is the one fault a browser recovers from without
// losing a rule, so it is the one fault the build may not turn into an
// error, in a plain project or behind a postcss config, on a page sheet.
describe('a page sheet whose only fault is a misplaced @import', () => {
  // The page sheet the build emitted, read back from dist.
  function shippedPageSheet(root: string, files: string[]): string {
    const sheet = files.find(
      (file) => file.endsWith('.css') && !file.endsWith('theme.css')
    )
    expect(sheet, files.join(',')).toBeDefined()
    return fs.readFileSync(
      path.join(root, 'dist', 'chrome', String(sheet)),
      'utf8'
    )
  }

  for (const mode of ['development', 'production'] as const) {
    it(`builds without error and keeps every rule in a plain project (${mode})`, async () => {
      const root = project(LATE_IMPORT_CSS, {surface: 'page'})
      const built = await build(root, mode)
      expect(rulesIn(shippedPageSheet(root, built.files))).toEqual([
        'keep-a',
        'keep-b',
        'keep-c'
      ])
    }, 180_000)

    it(`builds clean with exactly one warning naming the file behind a postcss config (${mode})`, async () => {
      const root = project(LATE_IMPORT_CSS, {surface: 'page', postcss: true})
      const built = await build(root, mode)
      expect(rulesIn(shippedPageSheet(root, built.files))).toEqual([
        'keep-a',
        'keep-b',
        'keep-c'
      ])
      const warnings = built.summary.warnings || []
      expect(warnings, warnings.join('\n---\n')).toHaveLength(1)
      expect(built.summary.warnings_count).toBe(1)
      expect(warnings[0]).toContain('options.css')
    }, 180_000)
  }
})
