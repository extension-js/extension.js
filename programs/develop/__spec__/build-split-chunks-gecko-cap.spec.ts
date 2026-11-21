import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import type {BrowserType} from '../types'
import {buildProject} from './helpers/build-project'
import {trackTempFolders} from './helpers/temp-folders'

// The Firefox store check stops parsing a script past 5 MB. A page can load
// any number of sibling files, so the Firefox build splits the shared chunk
// that would pass that size. Chrome keeps its one shared file.
const tempFolder = trackTempFolders()

const STORE_PARSE_LIMIT = 5 * 1024 * 1024
const MODULE_COUNT = 12

// Random text does not shrink under minification, so the emitted bytes track
// the source bytes: 12 shared modules of about 600 KB each, 7.2 MB in all.
function bigModule(name: string) {
  return `export const ${name} = "${crypto.randomBytes(300 * 1024).toString('hex')}"\n`
}

function project(
  options: {moduleCount?: number; pages?: string[]; config?: string} = {}
) {
  const root = tempFolder('extjs-gecko-cap-')
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'gecko-cap', version: '0.0.0'})
  )

  const pages = options.pages ?? ['popup', 'options']

  if (options.config) {
    fs.writeFileSync(path.join(root, 'extension.config.js'), options.config)
  }

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'gecko-cap',
      version: '1.0.0',
      action: {default_popup: 'popup.html'},
      ...(pages.includes('options') ? {options_ui: {page: 'options.html'}} : {})
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

async function build(root: string, browser: BrowserType) {
  return buildProject(root, {
    browser,
    mode: 'production'
  })
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

  // Nothing is shared when there is one page, so the page's own chunk is
  // the file that has to be split, and no part keeps the entry's name.
  it('splits the own chunk of a single page and lists every part', async () => {
    const root = project({pages: ['popup']})
    const summary = await build(root, 'firefox')
    expect(summary.errors_count).toBe(0)

    const distDir = path.join(root, 'dist', 'firefox')
    const scripts = scriptFiles(distDir)
    const parts = scripts.filter((file) => file.startsWith('action/'))
    expect(parts.length).toBeGreaterThan(1)

    for (const file of scripts) {
      expect(size(distDir, file), file).toBeLessThan(STORE_PARSE_LIMIT)
    }

    const total = parts.reduce((sum, file) => sum + size(distDir, file), 0)
    expect(total).toBeGreaterThan(STORE_PARSE_LIMIT)

    const srcs = scriptSrcs(distDir, 'action/index.html')
    expect([...srcs].sort()).toEqual(parts.map((file) => `/${file}`).sort())
    expect(new Set(srcs).size).toBe(srcs.length)

    // The entry chunk carries the runtime that boots the page, and it is
    // the last tag so every part before it has registered its modules.
    const entry = srcs[srcs.length - 1].slice(1)
    expect(fs.readFileSync(path.join(distDir, entry), 'utf8')).toContain(
      'document.title'
    )
  }, 180_000)

  it('lists every part of a page a project config splits on Chrome', async () => {
    const root = project({
      pages: ['popup'],
      moduleCount: 4,
      config: `module.exports = {
        config: (config) => {
          config.optimization.splitChunks.maxSize = 1024 * 1024
          return config
        }
      }\n`
    })
    const summary = await build(root, 'chrome')
    expect(summary.errors_count).toBe(0)

    const distDir = path.join(root, 'dist', 'chrome')
    const parts = scriptFiles(distDir).filter((file) =>
      file.startsWith('action/')
    )
    expect(parts.length).toBeGreaterThan(1)

    const srcs = scriptSrcs(distDir, 'action/index.html')
    expect([...srcs].sort()).toEqual(parts.map((file) => `/${file}`).sort())
    expect(new Set(srcs).size).toBe(srcs.length)
  }, 180_000)

  // A chunk behind import() is fetched by the runtime, so it can ship as
  // parts on every surface while each entry stays the one file it must be.
  it('splits a lazily loaded chunk on a page, a background and a content script', async () => {
    const root = project({pages: ['popup'], moduleCount: 0})
    const names = Array.from({length: 9}, (_, index) => `big${index}`)

    for (const name of names) {
      fs.writeFileSync(path.join(root, `${name}.js`), bigModule(name))
    }

    fs.writeFileSync(
      path.join(root, 'all.js'),
      `${names.map((name) => `import {${name}} from './${name}.js'`).join('\n')}\n` +
        `export const total = [${names.join(', ')}].reduce((sum, text) => sum + text.length, 0)\n`
    )

    const lazy = (mark: string) =>
      `import('./all.js').then((mod) => { globalThis.${mark} = mod.total })\n`

    fs.writeFileSync(path.join(root, 'popup.js'), lazy('popupTotal'))
    fs.writeFileSync(path.join(root, 'background.js'), lazy('backgroundTotal'))
    fs.writeFileSync(path.join(root, 'content.js'), lazy('contentTotal'))
    fs.writeFileSync(
      path.join(root, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'gecko-cap',
        version: '1.0.0',
        action: {default_popup: 'popup.html'},
        background: {scripts: ['background.js']},
        content_scripts: [
          {matches: ['https://example.com/*'], js: ['content.js']}
        ]
      })
    )

    const summary = await build(root, 'firefox')
    expect(summary.errors_count).toBe(0)

    const distDir = path.join(root, 'dist', 'firefox')
    const scripts = scriptFiles(distDir)

    for (const file of scripts) {
      expect(size(distDir, file), file).toBeLessThan(STORE_PARSE_LIMIT)
    }

    // The entries stay one file each, and the lazy parts sit beside them.
    const entries = [
      'action/index.js',
      'background/scripts.js',
      'content_scripts/content-0.js'
    ]
    expect(scripts).toEqual(expect.arrayContaining(entries))
    expect(scripts.filter((file) => file.startsWith('shared/'))).toEqual([])

    const parts = scripts.filter((file) => !entries.includes(file))
    expect(parts.length).toBeGreaterThan(1)

    const total = parts.reduce((sum, file) => sum + size(distDir, file), 0)
    expect(total).toBeGreaterThan(STORE_PARSE_LIMIT)
    expect(scriptSrcs(distDir, 'action/index.html')).toEqual([
      '/action/index.js'
    ])

    // Each entry asks the runtime for more than one part, and each part
    // it asks for was emitted.
    for (const entry of entries) {
      const source = fs.readFileSync(path.join(distDir, entry), 'utf8')
      const asked = [...source.matchAll(/\.e\((\d+)\)/g)].map(
        (match) => `${match[1]}.js`
      )
      expect(asked.length, entry).toBeGreaterThan(1)
      expect(parts, entry).toEqual(expect.arrayContaining(asked))
    }
  }, 180_000)
})
