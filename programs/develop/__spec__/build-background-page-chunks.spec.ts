import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

type Background = 'page' | 'scripts' | 'service_worker'

function project(background: Background) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-background-'))
  roots.push(root)

  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'background', version: '0.0.0'})
  )

  const manifest =
    background === 'service_worker'
      ? {
          manifest_version: 3,
          action: {default_popup: 'popup.html'},
          background: {service_worker: 'background.js'}
        }
      : {
          manifest_version: 2,
          browser_action: {default_popup: 'popup.html'},
          background:
            background === 'page'
              ? {page: 'background.html'}
              : {scripts: ['background.js']}
        }

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      name: 'background',
      version: '1.0.0',
      options_ui: {page: 'options.html'},
      ...manifest
    })
  )

  fs.writeFileSync(
    path.join(root, 'shared.js'),
    'export const shared = "SHARED_MARK_6d2a"\n'
  )

  const pages =
    background === 'page'
      ? ['popup', 'options', 'background']
      : ['popup', 'options']

  for (const page of pages) {
    fs.writeFileSync(
      path.join(root, `${page}.html`),
      `<html><body><div id="root"></div><script src="./${page}.js"></script></body></html>\n`
    )
  }

  for (const script of ['popup', 'options', 'background']) {
    fs.writeFileSync(
      path.join(root, `${script}.js`),
      "import {shared} from './shared.js'\nconsole.log(shared)\n"
    )
  }

  return root
}

async function build(root: string) {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'

  try {
    return await extensionBuild(root, {
      browser: 'chrome',
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

function splitWarnings(summary: {warnings?: string[]}) {
  return (summary.warnings || []).filter((text) =>
    text.includes('initial files')
  )
}

function scriptSrcs(html: string) {
  return [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1])
}

describe('the background entry under the default cache groups', () => {
  it('an MV2 background.page shares the page chunk like any other page', async () => {
    const root = project('page')
    const summary = await build(root)
    expect(summary.errors_count).toBe(0)
    expect(splitWarnings(summary)).toHaveLength(0)

    const distDir = path.join(root, 'dist', 'chrome')
    const read = (...parts: string[]) =>
      fs.readFileSync(path.join(distDir, ...parts), 'utf8')

    expect(read('shared', 'commons.js')).toContain('SHARED_MARK_6d2a')
    expect(read('background', 'index.js')).not.toContain('SHARED_MARK_6d2a')
    expect(scriptSrcs(read('background', 'index.html'))).toEqual([
      '/shared/commons.js',
      '/background/index.js'
    ])

    for (const page of ['action', 'options']) {
      expect(read(page, 'index.js')).not.toContain('SHARED_MARK_6d2a')
      expect(scriptSrcs(read(page, 'index.html'))).toEqual([
        '/shared/commons.js',
        `/${page}/index.js`
      ])
    }
  }, 120_000)

  it('MV2 background.scripts keeps one file that carries its shared code', async () => {
    const root = project('scripts')
    const summary = await build(root)
    expect(summary.errors_count).toBe(0)
    expect(splitWarnings(summary)).toHaveLength(0)

    const distDir = path.join(root, 'dist', 'chrome')
    const read = (...parts: string[]) =>
      fs.readFileSync(path.join(distDir, ...parts), 'utf8')

    expect(read('background', 'scripts.js')).toContain('SHARED_MARK_6d2a')
    expect(read('shared', 'commons.js')).toContain('SHARED_MARK_6d2a')
    expect(read('action', 'index.js')).not.toContain('SHARED_MARK_6d2a')
  }, 120_000)

  it('MV3 background.service_worker keeps one file that carries its shared code', async () => {
    const root = project('service_worker')
    const summary = await build(root)
    expect(summary.errors_count).toBe(0)
    expect(splitWarnings(summary)).toHaveLength(0)

    const distDir = path.join(root, 'dist', 'chrome')
    const read = (...parts: string[]) =>
      fs.readFileSync(path.join(distDir, ...parts), 'utf8')

    expect(read('background', 'service_worker.js')).toContain(
      'SHARED_MARK_6d2a'
    )

    expect(read('shared', 'commons.js')).toContain('SHARED_MARK_6d2a')
    expect(read('action', 'index.js')).not.toContain('SHARED_MARK_6d2a')
  }, 120_000)
})
