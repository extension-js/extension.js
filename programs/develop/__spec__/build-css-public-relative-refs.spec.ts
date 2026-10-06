import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

const MATCHES = 'https://public.example/*'
const PUBLIC_BYTES = Buffer.alloc(40_000, 'p')
const LOCAL_BYTES = Buffer.alloc(40_000, 'l')

const SPELLINGS = [
  '/images/x.png',
  '../public/images/x.png',
  './../public/images/x.png'
]

function write(root: string, relPath: string, contents: string | Buffer) {
  const abs = path.join(root, relPath)
  fs.mkdirSync(path.dirname(abs), {recursive: true})
  fs.writeFileSync(abs, contents)
}

function project(reference: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-css-public-rel-'))
  roots.push(root)

  write(
    root,
    'package.json',
    JSON.stringify({private: true, name: 'css-public-rel', version: '0.0.0'})
  )

  write(
    root,
    'manifest.json',
    JSON.stringify({
      manifest_version: 3,
      name: 'css-public-rel',
      version: '1.0.0',
      options_page: 'options/index.html',
      content_scripts: [
        {
          matches: [MATCHES],
          js: ['content/index.js'],
          css: ['content/declared.css']
        }
      ]
    })
  )

  write(root, 'public/images/x.png', PUBLIC_BYTES)
  write(root, 'local/y.png', LOCAL_BYTES)
  write(
    root,
    'options/index.html',
    '<!doctype html><html><head>\n<link rel="stylesheet" href="./options.css">\n</head><body><h1>options</h1></body></html>\n'
  )

  write(
    root,
    'options/options.css',
    `.page { background: url('${reference}') }\n`
  )

  write(
    root,
    'content/declared.css',
    `.declared { background: url('${reference}') }\n`
  )

  write(
    root,
    'content/imported.css',
    `.imported { background: url('${reference}') }\n`
  )

  write(root, 'content/index.js', "import './imported.css'\n")

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

function imagesIn(distDir: string): string[] {
  const hits: string[] = []

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const abs = path.join(dir, entry.name)

      if (entry.isDirectory()) walk(abs)
      else if (entry.name.endsWith('.png')) {
        hits.push(path.relative(distDir, abs).split(path.sep).join('/'))
      }
    }
  }

  walk(distDir)

  return hits.sort()
}

function readBuilt(distDir: string) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8')
  ) as {
    content_scripts: Array<{js: string[]; css: string[]}>
    web_accessible_resources?: Array<{resources: string[]; matches: string[]}>
  }
  const html = fs.readFileSync(
    path.join(distDir, 'options', 'index.html'),
    'utf8'
  )
  const href = /<link[^>]+href="([^"]+\.css)"/.exec(html)?.[1] || ''
  expect(href, `stylesheet link in ${html}`).toBeTruthy()
  const [script] = manifest.content_scripts
  const read = (name: string) =>
    fs.readFileSync(path.join(distDir, name.replace(/^\//, '')), 'utf8')

  return {
    pageCss: read(href),
    declaredCss: script.css.map(read).join('\n'),
    contentJs: script.js.map(read).join('\n'),
    war: manifest.web_accessible_resources || []
  }
}

describe('build: a stylesheet names a public-owned file once, whatever the spelling', () => {
  for (const mode of ['production', 'development'] as const) {
    for (const spelling of SPELLINGS) {
      it(`${mode}: url('${spelling}') ships one copy at the public path`, async () => {
        const distDir = await build(project(spelling), mode)
        const {pageCss, declaredCss, contentJs, war} = readBuilt(distDir)
        const rootUrl = /url\(\s*["']?\/images\/x\.png["']?\s*\)/

        expect(imagesIn(distDir)).toEqual(['images/x.png'])
        expect(fs.readFileSync(path.join(distDir, 'images', 'x.png'))).toEqual(
          PUBLIC_BYTES
        )

        expect(pageCss).toMatch(rootUrl)
        expect(declaredCss).toMatch(rootUrl)
        expect(contentJs).toContain(
          '__EXTENSIONJS_EXTENSION_ROOT__/images/x.png'
        )

        for (const text of [pageCss, declaredCss, contentJs]) {
          expect(text).not.toContain('extensionjs-public')
          expect(text).not.toMatch(/assets\/[^"')]*x[^"')]*\.png/)
        }

        const exposed = war.filter((group) =>
          group.resources.includes('images/x.png')
        )
        expect(exposed.flatMap((group) => group.matches)).toEqual([MATCHES])
      }, 120_000)
    }

    it(`${mode}: a relative url() to a file outside the public folder is still emitted as an asset, once`, async () => {
      const distDir = await build(project('../local/y.png'), mode)
      const {pageCss, declaredCss, contentJs, war} = readBuilt(distDir)
      const hashed = /url\(\s*["']?\/(assets\/y\.[a-f0-9]+\.png)["']?\s*\)/
      const emitted = hashed.exec(pageCss)?.[1] || ''

      expect(emitted, `hashed asset in ${pageCss}`).toBeTruthy()
      expect(declaredCss).toContain(emitted)
      expect(contentJs).toContain(emitted)
      expect(contentJs).not.toContain('assets/local/y.png')
      expect(imagesIn(distDir)).toEqual([emitted, 'images/x.png'].sort())
      expect(fs.readFileSync(path.join(distDir, emitted))).toEqual(LOCAL_BYTES)

      const exposed = war.filter((group) => group.resources.includes(emitted))
      expect(exposed.flatMap((group) => group.matches)).toEqual([MATCHES])
    }, 120_000)
  }
})
