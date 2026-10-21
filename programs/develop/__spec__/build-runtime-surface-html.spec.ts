import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

// Pages opened only through sidePanel.setOptions / offscreen.createDocument
// must go through the same HTML pipeline as a manifest page: script-imported
// CSS is injected, and url() images in a linked stylesheet ship in dist.
// They stay at the path the runtime asks for. A default side_panel in the
// same project still remaps to sidebar/index.html.
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function write(root: string, rel: string, contents: string) {
  const abs = path.join(root, rel)
  fs.mkdirSync(path.dirname(abs), {recursive: true})
  fs.writeFileSync(abs, contents)
}

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-runtime-html-'))
  roots.push(root)

  write(
    root,
    'package.json',
    JSON.stringify({private: true, name: 'runtime-html', version: '0.0.0'})
  )

  write(
    root,
    'manifest.json',
    JSON.stringify(
      {
        manifest_version: 3,
        name: 'runtime-html',
        version: '1.0.0',
        background: {service_worker: 'sw.js'},
        side_panel: {default_path: 'default-panel.html'},
        permissions: ['sidePanel', 'offscreen']
      },
      null,
      2
    )
  )

  write(
    root,
    'sw.js',
    [
      'chrome.sidePanel.setOptions({path: "panel.html"})',
      'chrome.offscreen.createDocument({url: "offscreen/index.html", reasons: ["DOM_PARSER"], justification: "parse html"})',
      ''
    ].join('\n')
  )

  write(
    root,
    'default-panel.html',
    '<!doctype html><html><body><p>manifest default panel</p></body></html>\n'
  )

  write(
    root,
    'panel.html',
    '<!doctype html><html><head>\n' +
      '<link rel="stylesheet" href="./panel.css">\n' +
      '</head><body><p>runtime panel</p>\n' +
      '<script type="module" src="./panel.js"></script>\n' +
      '</body></html>\n'
  )

  write(
    root,
    'panel.js',
    "import './imported.css'\ndocument.body.dataset.panel = 'yes'\n"
  )

  write(
    root,
    'panel.css',
    '.linked { background-image: url(./bg.png); color: navy }\n'
  )

  write(root, 'imported.css', '.from-import { color: tomato }\n')
  // Larger than the inline threshold, so it is emitted rather than inlined.
  write(root, 'bg.png', 'BGPNG'.repeat(512))

  write(
    root,
    'offscreen/index.html',
    '<!doctype html><html><head>\n' +
      '<link rel="stylesheet" href="./offscreen.css">\n' +
      '</head><body><p>offscreen document</p>\n' +
      '<script type="module" src="./offscreen.js"></script>\n' +
      '</body></html>\n'
  )

  write(
    root,
    'offscreen/offscreen.js',
    "import './imported.css'\ndocument.body.dataset.offscreen = 'yes'\n"
  )

  write(
    root,
    'offscreen/offscreen.css',
    '.offscreen { background-image: url(./bg.png); color: teal }\n'
  )

  write(root, 'offscreen/imported.css', '.offscreen-import { color: gold }\n')
  write(root, 'offscreen/bg.png', 'OFFPNG'.repeat(512))

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

function pageCss(distDir: string, htmlRel: string, featureCss: string): string {
  const html = fs.readFileSync(path.join(distDir, htmlRel), 'utf8')
  const hrefs = [...html.matchAll(/<link[^>]+href="([^"]+\.css)"/g)].map(
    (match) => match[1]
  )
  expect(
    hrefs.length,
    `stylesheet link in ${htmlRel}: ${html}`
  ).toBeGreaterThan(0)

  const href =
    hrefs.find((value) => value.replace(/^\//, '') === featureCss) ||
    hrefs[hrefs.length - 1]

  return fs.readFileSync(path.join(distDir, href.replace(/^\//, '')), 'utf8')
}

describe('build: runtime-set HTML surfaces compile like manifest pages', () => {
  for (const mode of ['production', 'development'] as const) {
    it(`${mode}: styles, imported CSS and stylesheet images ship at the runtime path`, async () => {
      const distDir = await build(project(), mode)

      // Manifest default panel still remaps; the runtime pages do not.
      expect(fs.existsSync(path.join(distDir, 'sidebar', 'index.html'))).toBe(
        true
      )

      expect(fs.existsSync(path.join(distDir, 'default-panel.html'))).toBe(
        false
      )

      expect(
        fs.readFileSync(path.join(distDir, 'sidebar', 'index.html'), 'utf8')
      ).toContain('manifest default panel')

      expect(fs.existsSync(path.join(distDir, 'panel.html'))).toBe(true)
      expect(fs.existsSync(path.join(distDir, 'panel.js'))).toBe(true)
      const panelHtml = fs.readFileSync(
        path.join(distDir, 'panel.html'),
        'utf8'
      )
      expect(panelHtml).toContain('runtime panel')
      expect(panelHtml).toMatch(/<link[^>]+href="[^"]+\.css"/)

      const panelCss = pageCss(distDir, 'panel.html', 'panel.css')
      expect(panelCss).toContain('from-import')
      expect(panelCss).toContain('tomato')
      expect(panelCss).toMatch(
        /url\(\s*["']?\/assets\/bg\.[a-f0-9]+\.png["']?\s*\)/
      )

      expect(filesNamed(distDir, 'bg').length).toBeGreaterThan(0)

      expect(fs.existsSync(path.join(distDir, 'offscreen', 'index.html'))).toBe(
        true
      )

      expect(fs.existsSync(path.join(distDir, 'offscreen', 'index.js'))).toBe(
        true
      )

      const offscreenHtml = fs.readFileSync(
        path.join(distDir, 'offscreen', 'index.html'),
        'utf8'
      )
      expect(offscreenHtml).toContain('offscreen document')
      expect(offscreenHtml).toMatch(/<link[^>]+href="[^"]+\.css"/)

      const offscreenCss = pageCss(
        distDir,
        path.join('offscreen', 'index.html'),
        'offscreen/index.css'
      )
      expect(offscreenCss).toContain('offscreen-import')
      expect(offscreenCss).toContain('gold')
      expect(offscreenCss).toMatch(
        /url\(\s*["']?\/assets\/(?:offscreen\/)?bg\.[a-f0-9]+\.png["']?\s*\)/
      )
    }, 120_000)
  }
})
