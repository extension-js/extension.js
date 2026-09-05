import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

// A <base href> plays two roles: it locates the page's files at build time
// and it moves the document base for links at runtime. The build keeps the
// first for assets and bakes the second into the ordinary links, so the
// emitted page asks for files that exist while links keep their target.
const EXT_ORIGIN = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function fixture(options: {
  head?: string
  body?: string
  extra?: Record<string, string>
}) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'extjs-base-href-'))
  )
  roots.push(root)
  fs.mkdirSync(path.join(root, 'src', 'sub'), {recursive: true})
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'base-href', version: '0.0.0'})
  )
  fs.writeFileSync(
    path.join(root, 'src/manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'base-href',
      version: '1.0.0',
      action: {default_popup: 'popup.html'}
    })
  )
  fs.writeFileSync(
    path.join(root, 'src/popup.html'),
    `<!doctype html>\n<html>\n<head>${options.head || ''}</head>\n<body>\n${options.body || ''}\n</body>\n</html>\n`
  )
  fs.writeFileSync(path.join(root, 'src/sub/logo.png'), 'PNGDATA\n')
  fs.writeFileSync(
    path.join(root, 'src/popup.js'),
    'globalThis.__BASE_HREF_SENTINEL__ = "real-script-code"\n'
  )
  for (const [rel, content] of Object.entries(options.extra || {})) {
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
    const summary = await extensionBuild(path.join(root, 'src'), {
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
  const files: string[] = []
  const walk = (dir: string, prefix = '') => {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      if (entry.isDirectory())
        walk(path.join(dir, entry.name), `${prefix}${entry.name}/`)
      else files.push(prefix + entry.name)
    }
  }
  walk(distDir)
  const pageRel = files.find((file) => file.endsWith('.html')) as string
  const html = fs.readFileSync(path.join(distDir, pageRel), 'utf8')
  const refsOf = (tag: string) =>
    [
      ...html.matchAll(
        new RegExp(`<${tag}\\b[^>]*?(?:src|href)="([^"]*)"`, 'g')
      )
    ].map((match) => match[1])
  const survivingBase = (html.match(/<base\b[^>]*href="([^"]*)"/) || [])[1]
  // Resolve a ref the way the browser will: from the built page's own
  // location, or from a <base href> that survived into the output.
  const resolve = (ref: string) => {
    const docBase = new URL(`${EXT_ORIGIN}/${pageRel}`)
    const base = survivingBase ? new URL(survivingBase, docBase) : docBase
    const url = new URL(ref, base)
    if (!url.href.startsWith(`${EXT_ORIGIN}/`))
      return {local: false, url: url.href}
    return {local: true, path: url.pathname.replace(/^\//, '')}
  }
  const read = (rel: string) => fs.readFileSync(path.join(distDir, rel), 'utf8')
  return {files, html, refsOf, resolve, read}
}

const RELATIVE = {
  head: '<base href="sub/">',
  body: '<img src="logo.png">\n<script src="popup.js"></script>'
}
const EXTERNAL = {
  head: '<base href="https://cdn.example.com/x/">',
  body: '<img src="sub/logo.png">\n<a href="page.html">link</a>\n<script src="popup.js"></script>'
}

describe('<base href> on an extension page', () => {
  it('relative base: the image lands on an emitted file', async () => {
    const built = await build(fixture(RELATIVE))
    const resolved = built.resolve(built.refsOf('img')[0])
    expect(resolved.local).toBe(true)
    expect(built.files).toContain(resolved.path)
  }, 120_000)

  it('relative base: the script ships its real code', async () => {
    const built = await build(fixture(RELATIVE))
    const resolved = built.resolve(built.refsOf('script')[0])
    expect(resolved.local).toBe(true)
    expect(built.read(resolved.path as string)).toContain(
      '__BASE_HREF_SENTINEL__'
    )
  }, 120_000)

  it('external base: assets stay inside the extension and exist', async () => {
    const built = await build(fixture(EXTERNAL))
    const refs = [
      ...built.refsOf('img'),
      ...built.refsOf('script'),
      ...built.refsOf('link')
    ]
    expect(refs.length).toBeGreaterThan(0)
    for (const ref of refs) {
      const resolved = built.resolve(ref)
      expect(resolved, ref).toMatchObject({local: true})
      expect(built.files, ref).toContain(resolved.path)
    }
  }, 120_000)

  it('external base: ordinary links still go to that site', async () => {
    const built = await build(fixture(EXTERNAL))
    const resolved = built.resolve(built.refsOf('a')[0])
    expect(resolved).toEqual({
      local: false,
      url: 'https://cdn.example.com/x/page.html'
    })
  }, 120_000)

  it('no base: the page resolves as before', async () => {
    const built = await build(
      fixture({
        body: '<img src="sub/logo.png">\n<script src="popup.js"></script>'
      })
    )
    const image = built.resolve(built.refsOf('img')[0])
    const script = built.resolve(built.refsOf('script')[0])
    expect(image).toEqual({local: true, path: 'assets/sub/logo.png'})
    expect(script).toEqual({local: true, path: 'action/index.js'})
    expect(built.read('action/index.js')).toContain('__BASE_HREF_SENTINEL__')
  }, 120_000)

  it('a public-folder reference is not re-based onto the tag', async () => {
    const built = await build(
      fixture({
        head: '<base href="sub/">',
        body: '<img src="/public/pic.png">\n<script src="popup.js"></script>',
        extra: {'src/public/pic.png': 'PUBLICPNG\n'}
      })
    )
    const ref = built.refsOf('img')[0]
    expect(ref).not.toMatch(/sub\//)
    const resolved = built.resolve(ref)
    expect(resolved.local).toBe(true)
    expect(built.files).toContain(resolved.path)
  }, 120_000)
})
