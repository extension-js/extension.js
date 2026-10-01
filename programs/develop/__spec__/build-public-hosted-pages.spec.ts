import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQAB' +
    'h6FO1AAAAABJRU5ErkJggg==',
  'base64'
)
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project(
  manifestRel: string,
  manifest: Record<string, unknown>,
  files: Record<string, Buffer | string>
) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'extjs-public-hosted-pages-')
  )
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'public-hosted', version: '0.0.0'})
  )

  const manifestPath = path.join(root, manifestRel)
  fs.mkdirSync(path.dirname(manifestPath), {recursive: true})
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({
      manifest_version: 3,
      name: 'P',
      version: '1.0.0',
      ...manifest
    })
  )

  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel)
    fs.mkdirSync(path.dirname(abs), {recursive: true})
    fs.writeFileSync(abs, content)
  }

  return root
}

async function build(root: string) {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'

  try {
    const summary = await extensionBuild(root, {
      browser: 'chrome',
      silent: true,
      install: false,
      mode: 'production',
      exitOnError: false
    } as any)
    expect(summary.errors_count).toBe(0)
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }

  const distDir = path.join(root, 'dist', 'chrome')

  return {
    distDir,
    files: listFiles(distDir),
    manifest: JSON.parse(
      fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8')
    )
  }
}

function listFiles(dir: string, prefix = ''): string[] {
  const out: string[] = []

  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    if (entry.name === 'extension-js') continue

    const rel = prefix ? `${prefix}/${entry.name}` : entry.name

    if (entry.isDirectory())
      {out.push(...listFiles(path.join(dir, entry.name), rel))}
    else out.push(rel)
  }

  return out.sort()
}

describe('manifest pages and icons hosted in public/', () => {
  it('ships a src/ manifest popup and icon from the root public/ verbatim', async () => {
    const root = project(
      'src/manifest.json',
      {
        icons: {16: 'icons/16.png'},
        action: {
          default_popup: 'app/popups/not-found.html',
          default_icon: {16: 'icons/16.png'}
        }
      },
      {
        'public/icons/16.png': PNG,
        'public/app/popups/not-found.html':
          '<!doctype html><html><body><h1>not found</h1></body></html>'
      }
    )

    const {files, manifest} = await build(root)

    expect(manifest.action.default_popup).toBe('app/popups/not-found.html')
    expect(manifest.action.default_icon).toEqual({16: 'icons/16.png'})
    expect(manifest.icons).toEqual({16: 'icons/16.png'})
    expect(files).toEqual([
      'app/popups/not-found.html',
      'icons/16.png',
      'manifest.json'
    ])
  })

  it('ships root-manifest pages and a nested public/ icon verbatim', async () => {
    const root = project(
      'manifest.json',
      {
        icons: {16: 'public/img/logo/16x16.png'},
        action: {
          default_popup: 'popup.html',
          default_icon: 'img/logo/16x16.png'
        },
        options_ui: {page: 'options/options.html'}
      },
      {
        'public/img/logo/16x16.png': PNG,
        'public/popup.html': '<!doctype html><html><body>popup</body></html>',
        'public/options/options.html':
          '<!doctype html><html><body>options</body></html>'
      }
    )

    const {files, manifest} = await build(root)

    expect(manifest.action.default_popup).toBe('popup.html')
    expect(manifest.action.default_icon).toBe('img/logo/16x16.png')
    expect(manifest.icons).toEqual({16: 'img/logo/16x16.png'})
    expect(manifest.options_ui.page).toBe('options/options.html')
    expect(files).toEqual([
      'img/logo/16x16.png',
      'manifest.json',
      'options/options.html',
      'popup.html'
    ])
  })

  it('still compiles a popup that lives beside the manifest', async () => {
    const root = project(
      'src/manifest.json',
      {action: {default_popup: 'popup.html'}},
      {
        'src/popup.html':
          '<!doctype html><html><body><script src="./popup.js"></script></body></html>',
        'src/popup.js': 'document.title = "popup"',
        'public/popup.html': '<!doctype html><html><body>stale</body></html>'
      }
    )

    const {files, manifest} = await build(root)

    expect(manifest.action.default_popup).toBe('action/index.html')
    expect(files).toContain('action/index.html')
    expect(files).toContain('action/index.js')
  })
})
