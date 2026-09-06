import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

// A page stylesheet's root-absolute url() to a file public/ owns must keep
// naming the copier's root path: the page resolves it against the extension
// origin, and a second hashed copy under assets/ is the same bytes twice.
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

const PAGE_CSS =
  '.public { background: url("/img/bg.png") }\n' +
  '.local { background: url("./local.png") }\n' +
  '.remote { background: url("https://cdn.example/x.png") }\n'

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-page-public-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'page-public', version: '0.0.0'})
  )
  fs.mkdirSync(path.join(root, 'public', 'img'), {recursive: true})
  fs.writeFileSync(path.join(root, 'public', 'img', 'bg.png'), 'PUBLICPNG\n')
  // Larger than the inline threshold, so it is emitted rather than inlined.
  fs.writeFileSync(path.join(root, 'local.png'), 'LOCALPNG'.repeat(512))
  fs.writeFileSync(
    path.join(root, 'options.html'),
    '<!doctype html><html><head>\n<link rel="stylesheet" href="./options.css">\n</head><body><h1>options</h1></body></html>\n'
  )
  fs.writeFileSync(path.join(root, 'options.css'), PAGE_CSS)
  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'page-public',
      version: '1.0.0',
      options_page: 'options.html'
    })
  )
  return root
}

async function build(root: string, mode: 'development' | 'production') {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'
  try {
    const summary = await extensionBuild(root, {
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
  return path.join(root, 'dist', 'chrome')
}

function filesNamed(distDir: string, basename: string): string[] {
  const hits: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(abs)
      else if (entry.name.startsWith(basename)) {
        hits.push(path.relative(distDir, abs).split(path.sep).join('/'))
      }
    }
  }
  walk(distDir)
  return hits.sort()
}

// The one stylesheet the options page links, wherever the build placed it.
function pageCss(distDir: string): string {
  const html = fs.readFileSync(
    path.join(distDir, 'options', 'index.html'),
    'utf8'
  )
  const href = /<link[^>]+href="([^"]+\.css)"/.exec(html)?.[1] || ''
  expect(href, `stylesheet link in ${html}`).toBeTruthy()
  return fs.readFileSync(path.join(distDir, href.replace(/^\//, '')), 'utf8')
}

describe('build: a page stylesheet keeps a public-owned root url() at the root', () => {
  for (const mode of ['production', 'development'] as const) {
    it(`${mode}: ships the public file once and names it by its root path`, async () => {
      const distDir = await build(project(), mode)
      const css = pageCss(distDir)

      expect(css).toMatch(/url\(\s*["']?\/img\/bg\.png["']?\s*\)/)
      expect(css).not.toMatch(/assets\/bg/)
      expect(css).not.toContain('extensionjs-public')
      expect(filesNamed(distDir, 'bg')).toEqual(['img/bg.png'])
      expect(fs.readFileSync(path.join(distDir, 'img', 'bg.png'), 'utf8')).toBe(
        'PUBLICPNG\n'
      )

      // A relative reference still goes through the module graph.
      expect(css).toMatch(
        /url\(\s*["']?\/assets\/local\.[a-f0-9]+\.png["']?\s*\)/
      )
      expect(filesNamed(distDir, 'local')).toHaveLength(1)
      expect(css).toContain('https://cdn.example/x.png')
    }, 120_000)
  }
})
