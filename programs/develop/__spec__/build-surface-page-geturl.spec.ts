import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-surface-geturl-'))
  roots.push(root)

  const all: Record<string, string> = {
    'package.json': JSON.stringify({
      private: true,
      name: 'surface-geturl',
      version: '0.0.0'
    }),
    ...files
  }

  for (const [rel, content] of Object.entries(all)) {
    const abs = path.join(root, rel)
    fs.mkdirSync(path.dirname(abs), {recursive: true})
    fs.writeFileSync(abs, content)
  }

  return root
}

async function build(root: string, mode: 'production' | 'development') {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'

  try {
    return await extensionBuild(root, {
      browser: 'chrome',
      silent: true,
      install: false,
      mode,
      exitOnError: false
    } as never)
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
}

function dist(root: string, rel: string) {
  return path.join(root, 'dist', 'chrome', rel)
}

function read(root: string, rel: string) {
  return fs.readFileSync(dist(root, rel), 'utf8')
}

const SIDEBAR_FILES = {
  'manifest.json': JSON.stringify({
    manifest_version: 3,
    name: 'surface-geturl',
    version: '1.0.0',
    side_panel: {default_path: 'sidebar.html'},
    background: {service_worker: 'background.js'}
  }),
  'sidebar.html':
    '<!doctype html><html><head><link rel="stylesheet" href="./sidebar.css"></head>' +
    '<body><h1>SURFACE_GETURL_PAGE</h1><script src="./sidebar.ts"></script></body></html>\n',
  'sidebar.css': 'h1 { color: rebeccapurple }\n',
  'sidebar.ts': 'console.log("SURFACE_GETURL_SCRIPT")\nexport {}\n',
  'background.js':
    'chrome.runtime.onInstalled.addListener(() => {\n' +
    '  console.log(chrome.runtime.getURL("sidebar.html"))\n' +
    '})\n'
}

describe('a manifest surface page a runtime.getURL literal also names', () => {
  for (const mode of ['production', 'development'] as const) {
    it(`is served at the literal path as the same compiled page in ${mode}`, async () => {
      const root = project(SIDEBAR_FILES)
      await build(root, mode)

      const manifest = JSON.parse(read(root, 'manifest.json')) as {
        side_panel: {default_path: string}
      }

      expect(manifest.side_panel.default_path).toBe('sidebar/index.html')
      expect(fs.existsSync(dist(root, 'sidebar.html'))).toBe(true)

      const surface = read(root, 'sidebar/index.html')
      const literal = read(root, 'sidebar.html')

      expect(literal).toBe(surface)
      expect(literal).toContain('SURFACE_GETURL_PAGE')
      expect(literal).toContain('src="/sidebar/index.js"')
      expect(literal).toContain('href="/sidebar/index.css"')
      expect(literal).not.toContain('sidebar.ts')

      expect(read(root, 'background/service_worker.js')).toContain(
        'sidebar.html'
      )

      expect(fs.existsSync(dist(root, 'sidebar.ts'))).toBe(false)
    }, 180_000)
  }

  it('ships one page when the literal spells the surface path the manifest already uses', async () => {
    const root = project({
      ...SIDEBAR_FILES,
      'manifest.json': JSON.stringify({
        manifest_version: 3,
        name: 'surface-geturl',
        version: '1.0.0',
        side_panel: {default_path: 'sidebar/index.html'},
        background: {service_worker: 'background.js'}
      }),
      'sidebar/index.html': SIDEBAR_FILES['sidebar.html']
        .replace('href="./sidebar.css"', 'href="../sidebar.css"')
        .replace('src="./sidebar.ts"', 'src="../sidebar.ts"'),
      'background.js':
        'console.log(chrome.runtime.getURL("sidebar/index.html"))\n'
    })
    await build(root, 'production')

    const pages = (
      fs.readdirSync(dist(root, '.'), {recursive: true}) as string[]
    )
      .map((entry) => String(entry).split(path.sep).join('/'))
      .filter((entry) => entry.endsWith('.html'))

    expect(pages).toEqual(['sidebar/index.html'])
  }, 180_000)
})
