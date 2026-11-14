import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

// The Firefox store check stops parsing a script past 5 MB. A page can load
// any number of sibling files, so the Firefox build splits the shared chunk
// that would pass that size. Chrome keeps its one shared file.
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

const STORE_PARSE_LIMIT = 5 * 1024 * 1024
const MODULE_COUNT = 12

// Random text does not shrink under minification, so the emitted bytes track
// the source bytes: 12 shared modules of about 600 KB each, 7.2 MB in all.
function bigModule(name: string) {
  return `export const ${name} = "${crypto.randomBytes(300 * 1024).toString('hex')}"\n`
}

function project(options: {moduleCount?: number} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-gecko-cap-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'gecko-cap', version: '0.0.0'})
  )

  const pages = ['popup', 'options']

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'gecko-cap',
      version: '1.0.0',
      action: {default_popup: 'popup.html'},
      options_ui: {page: 'options.html'}
    })
  )

  const names = Array.from(
    {length: options.moduleCount ?? MODULE_COUNT},
    (_, index) => `big${index}`
  )

  for (const name of names) {
    fs.writeFileSync(path.join(root, `${name}.js`), bigModule(name))
  }

  const imports = names
    .map((name) => `import {${name}} from './${name}.js'`)
    .join('\n')

  for (const page of pages) {
    fs.writeFileSync(
      path.join(root, `${page}.html`),
      `<html><body><div id="root"></div><script type="module" src="./${page}.js"></script></body></html>\n`
    )

    fs.writeFileSync(
      path.join(root, `${page}.js`),
      `${imports}\ndocument.title = '${page}' + [${names.join(', ')}].map((text) => text.length).join()\n`
    )
  }

  return root
}

async function build(root: string, browser: string) {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'

  try {
    return await extensionBuild(root, {
      browser,
      silent: true,
      install: false,
      mode: 'production',
      exitOnError: false
    } as any)
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
}

function scriptFiles(dir: string, base = dir): string[] {
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
    const full = path.join(dir, entry.name)

    if (entry.isDirectory()) return scriptFiles(full, base)

    return entry.name.endsWith('.js')
      ? [path.relative(base, full).split(path.sep).join('/')]
      : []
  })
}

function scriptSrcs(distDir: string, file: string) {
  const html = fs.readFileSync(path.join(distDir, file), 'utf8')

  return [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/gi)].map((m) => m[1])
}

function size(distDir: string, file: string) {
  return fs.statSync(path.join(distDir, file)).size
}

describe('Firefox shared chunk size cap', () => {
  it('splits a shared chunk that would pass the store parse limit', async () => {
    const root = project()
    const summary = await build(root, 'firefox')
    expect(summary.errors_count).toBe(0)

    const distDir = path.join(root, 'dist', 'firefox')
    const scripts = scriptFiles(distDir)
    const parts = scripts.filter((file) => file.startsWith('shared/commons'))
    expect(parts.length).toBeGreaterThan(1)
    expect(parts).not.toContain('shared/commons.js')

    for (const file of scripts) {
      expect(size(distDir, file), file).toBeLessThan(STORE_PARSE_LIMIT)
    }

    const total = parts.reduce((sum, file) => sum + size(distDir, file), 0)
    expect(total).toBeGreaterThan(STORE_PARSE_LIMIT)

    // Each page loads every part, then its own entry.
    for (const [page, entry] of [
      ['action/index.html', '/action/index.js'],
      ['options/index.html', '/options/index.js']
    ]) {
      const srcs = scriptSrcs(distDir, page)
      expect(srcs.slice(0, -1).sort()).toEqual(
        parts.map((file) => `/${file}`).sort()
      )

      expect(srcs[srcs.length - 1]).toBe(entry)
    }
  }, 180_000)

  it('keeps the one shared file when the shared code is small', async () => {
    const root = project({moduleCount: 2})
    const summary = await build(root, 'firefox')
    expect(summary.errors_count).toBe(0)

    const distDir = path.join(root, 'dist', 'firefox')
    expect(
      scriptFiles(distDir).filter((file) => file.startsWith('shared/'))
    ).toEqual(['shared/commons.js'])

    expect(scriptSrcs(distDir, 'action/index.html')).toEqual([
      '/shared/commons.js',
      '/action/index.js'
    ])
  }, 180_000)

  it('leaves the Chrome build with one shared file', async () => {
    const root = project()
    const summary = await build(root, 'chrome')
    expect(summary.errors_count).toBe(0)

    const distDir = path.join(root, 'dist', 'chrome')
    expect(
      scriptFiles(distDir).filter((file) => file.startsWith('shared/'))
    ).toEqual(['shared/commons.js'])

    expect(size(distDir, 'shared/commons.js')).toBeGreaterThan(
      STORE_PARSE_LIMIT
    )

    expect(scriptSrcs(distDir, 'action/index.html')).toEqual([
      '/shared/commons.js',
      '/action/index.js'
    ])
  }, 180_000)
})
