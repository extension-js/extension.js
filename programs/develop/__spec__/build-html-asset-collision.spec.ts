import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

// Two pages in different folders that each reference their own ./logo.png
// are two files. Each built page must point at a file in dist that carries
// its own bytes, and a reference that leaves the extension root must still
// land inside dist.
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project() {
  const outer = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-html-assets-'))
  )
  roots.push(outer)
  const root = path.join(outer, 'app')
  fs.mkdirSync(path.join(root, 'pages', 'a'), {recursive: true})
  fs.mkdirSync(path.join(root, 'pages', 'b'), {recursive: true})
  fs.mkdirSync(path.join(outer, 'design'), {recursive: true})
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'assets', version: '0.0.0'})
  )
  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'Assets',
      version: '1.0.0',
      action: {default_popup: 'pages/a/index.html'},
      options_page: 'pages/b/index.html'
    })
  )
  fs.writeFileSync(path.join(root, 'pages', 'a', 'logo.png'), 'LOGO-A')
  fs.writeFileSync(path.join(root, 'pages', 'b', 'logo.png'), 'LOGO-B')
  fs.writeFileSync(path.join(outer, 'design', 'logo.png'), 'LOGO-OUTSIDE')
  fs.writeFileSync(
    path.join(root, 'pages', 'a', 'index.html'),
    '<!doctype html><title>A</title><img id="own" src="./logo.png"><img id="outside" src="../../../design/logo.png">'
  )
  fs.writeFileSync(
    path.join(root, 'pages', 'b', 'index.html'),
    '<!doctype html><title>B</title><img id="own" src="./logo.png">'
  )
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
  const page = (rel: string) => fs.readFileSync(path.join(distDir, rel), 'utf8')
  // Read an <img id> ref the way the browser resolves it from the page.
  const imageBytes = (pageRel: string, id: string) => {
    const html = page(pageRel)
    const ref = html.match(new RegExp(`<img id="${id}" src="([^"]+)"`))?.[1]
    expect(ref, `${id} ref in ${pageRel}`).toBeTruthy()
    const url = new URL(
      String(ref),
      `chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/${pageRel}`
    )
    const rel = url.pathname.replace(/^\//, '')
    expect(rel.split('/')).not.toContain('..')
    const abs = path.join(distDir, rel)
    expect(fs.existsSync(abs), `${ref} missing from dist`).toBe(true)
    return fs.readFileSync(abs, 'utf8')
  }
  return {distDir, imageBytes}
}

describe('static assets referenced from html pages', () => {
  it('keep one file per source when two pages name the same basename', async () => {
    const {imageBytes} = await build(project())
    expect(imageBytes('action/index.html', 'own')).toBe('LOGO-A')
    expect(imageBytes('options/index.html', 'own')).toBe('LOGO-B')
  }, 120_000)

  it('land inside dist when the reference leaves the extension root', async () => {
    const {imageBytes} = await build(project())
    expect(imageBytes('action/index.html', 'outside')).toBe('LOGO-OUTSIDE')
  }, 120_000)
})
