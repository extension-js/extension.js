import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {buildProject} from './helpers/build-project'
import {trackTempFolders} from './helpers/temp-folders'
import {writeExtensionProject} from './helpers/extension-project'

// A user cache group that spans every chunk is narrowed to the page chunks,
// and the emitted HTML loads every sibling file, so the build stays quiet.
// Only a user chunks function can still split the single-file surfaces, and
// that one entry has to be named under a green build.
const tempFolder = trackTempFolders()

type Selector = 'all' | 'async' | 'every-chunk'

function project(selector: Selector) {
  const root = tempFolder('extjs-split-chunks-')
  writeExtensionProject(root, {
    name: 'split-chunks',
    manifest: {
      action: {default_popup: 'popup.html'},
      options_ui: {page: 'options.html'},
      background: {service_worker: 'background.js'}
    }
  })

  fs.writeFileSync(
    path.join(root, 'shared.js'),
    'export function greet(name) {\n  globalThis.__greet = "SHARED_MARK_5e2c"\n  return "hello " + name\n}\n'
  )

  for (const page of ['popup', 'options']) {
    fs.writeFileSync(
      path.join(root, `${page}.html`),
      `<html><body><div id="root"></div><script src="./${page}.js"></script></body></html>\n`
    )

    fs.writeFileSync(
      path.join(root, `${page}.js`),
      `import {greet} from './shared.js'\ndocument.getElementById('root').textContent = greet('${page}')\n`
    )
  }

  fs.writeFileSync(
    path.join(root, 'background.js'),
    "import {greet} from './shared.js'\nconsole.log(greet('background'))\n"
  )

  const chunks = selector === 'every-chunk' ? '() => true' : `'${selector}'`
  fs.writeFileSync(
    path.join(root, 'extension.config.js'),
    [
      'module.exports = {',
      '  config: (config) => ({',
      '    ...config,',
      '    optimization: {',
      '      ...config.optimization,',
      '      splitChunks: {',
      '        ...config.optimization.splitChunks,',
      `        chunks: ${chunks}`,
      '      }',
      '    }',
      '  })',
      '}',
      ''
    ].join('\n')
  )

  return root
}

async function build(root: string) {
  return buildProject(root, {
    mode: 'production'
  })
}

function splitWarnings(summary: {warnings?: string[]}) {
  return (summary.warnings || []).filter((text) =>
    text.includes('initial files')
  )
}

function scriptSrcs(html: string) {
  return [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1])
}

describe('build with a user chunks selector on the default cache groups', () => {
  it("chunks: 'all' shares the module between the pages and stays quiet", async () => {
    const root = project('all')
    const summary = await build(root)
    expect(summary.errors_count).toBe(0)
    expect(splitWarnings(summary)).toHaveLength(0)

    const distDir = path.join(root, 'dist', 'chrome')
    expect(fs.existsSync(path.join(distDir, 'shared', 'commons.js'))).toBe(true)
    expect(
      fs.readFileSync(path.join(distDir, 'shared', 'commons.js'), 'utf8')
    ).toContain('SHARED_MARK_5e2c')

    for (const page of ['action', 'options']) {
      const html = fs.readFileSync(
        path.join(distDir, page, 'index.html'),
        'utf8'
      )
      expect(scriptSrcs(html)).toEqual([
        '/shared/commons.js',
        `/${page}/index.js`
      ])

      expect(
        fs.readFileSync(path.join(distDir, page, 'index.js'), 'utf8')
      ).not.toContain('SHARED_MARK_5e2c')
    }

    // The guard kept the background out of the cache group.
    expect(
      fs.readFileSync(
        path.join(distDir, 'background', 'service_worker.js'),
        'utf8'
      )
    ).toContain('SHARED_MARK_5e2c')
  }, 120_000)

  it("chunks: 'async' leaves every entry as one file and stays quiet", async () => {
    const root = project('async')
    const summary = await build(root)
    expect(summary.errors_count).toBe(0)
    expect(splitWarnings(summary)).toHaveLength(0)

    const distDir = path.join(root, 'dist', 'chrome')
    expect(fs.existsSync(path.join(distDir, 'shared'))).toBe(false)

    for (const page of ['action', 'options']) {
      const html = fs.readFileSync(
        path.join(distDir, page, 'index.html'),
        'utf8'
      )
      expect(scriptSrcs(html)).toEqual([`/${page}/index.js`])
    }
  }, 120_000)

  it('a user chunks function that spans the background warns for it only', async () => {
    const root = project('every-chunk')
    const summary = await build(root)
    expect(summary.errors_count).toBe(0)

    const distDir = path.join(root, 'dist', 'chrome')
    expect(fs.existsSync(path.join(distDir, 'shared', 'commons.js'))).toBe(true)
    const warnings = splitWarnings(summary)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain(
      'background/service_worker is split into 2 initial files, but the background registration loads only background/service_worker.js'
    )

    expect(warnings[0]).toContain('NOT LOADED shared/commons.js')
    expect(warnings[0]).toContain('the background script never starts')
    expect(warnings[0]).toContain(
      'https://extension.js.org/docs/features/rspack-configuration#share-a-module-between-entries'
    )

    for (const page of ['action', 'options']) {
      const html = fs.readFileSync(
        path.join(distDir, page, 'index.html'),
        'utf8'
      )
      expect(scriptSrcs(html)).toEqual([
        '/shared/commons.js',
        `/${page}/index.js`
      ])
    }
  }, 120_000)
})
