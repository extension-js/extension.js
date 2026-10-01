import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-entry-group-'))
  roots.push(root)

  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'entry-group', version: '0.0.0'})
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'entry-group',
      version: '1.0.0',
      action: {default_popup: 'popup.html'},
      options_ui: {page: 'options.html'},
      background: {service_worker: 'background.js'},
      content_scripts: [{matches: ['<all_urls>'], js: ['content.js']}]
    })
  )

  fs.writeFileSync(
    path.join(root, 'shared.js'),
    'export const shared = "SHARED_MARK_9c4d"\n'
  )

  for (const page of ['popup', 'options']) {
    fs.writeFileSync(
      path.join(root, `${page}.html`),
      `<html><body><div id="root"></div><script src="./${page}.js"></script></body></html>\n`
    )

    fs.writeFileSync(
      path.join(root, `${page}.js`),
      "import {shared} from './shared.js'\ndocument.getElementById('root').textContent = shared\n"
    )
  }

  for (const script of ['background', 'content']) {
    fs.writeFileSync(
      path.join(root, `${script}.js`),
      "import {shared} from './shared.js'\nconsole.log(shared)\n"
    )
  }

  fs.mkdirSync(path.join(root, 'changelog'))
  fs.writeFileSync(
    path.join(root, 'changelog', 'changelog.js'),
    "import {shared} from '../shared.js'\ndocument.body.textContent = 'changelog ' + shared\n"
  )

  fs.writeFileSync(
    path.join(root, 'extension.config.js'),
    [
      'module.exports = {',
      '  config: (config) => ({',
      '    ...config,',
      "    entry: {...config.entry, 'changelog/changelog': './changelog/changelog.js'},",
      '    optimization: {',
      '      ...config.optimization,',
      '      splitChunks: {',
      '        ...config.optimization.splitChunks,',
      '        cacheGroups: {',
      '          ...config.optimization.splitChunks.cacheGroups,',
      '          probe: {',
      '            test: /shared\\.js$/,',
      "            name: 'probe-vendor',",
      "            chunks: 'all',",
      '            priority: 50,',
      '            enforce: true',
      '          }',
      '        }',
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

function scriptSrcs(html: string) {
  return [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1])
}

describe('a user cache group with its own chunks selector', () => {
  it('leaves an extra config entry and the single-file surfaces whole', async () => {
    const root = project()
    const summary = await build(root)
    expect(summary.errors_count).toBe(0)
    expect(
      (summary.warnings || []).filter((text: string) =>
        text.includes('initial files')
      )
    ).toHaveLength(0)

    const distDir = path.join(root, 'dist', 'chrome')
    const read = (...parts: string[]) =>
      fs.readFileSync(path.join(distDir, ...parts), 'utf8')

    expect(read('changelog', 'changelog.js')).toContain('SHARED_MARK_9c4d')
    expect(read('background', 'service_worker.js')).toContain(
      'SHARED_MARK_9c4d'
    )

    expect(read('content_scripts', 'content-0.js')).toContain(
      'SHARED_MARK_9c4d'
    )

    expect(read('probe-vendor.js')).toContain('SHARED_MARK_9c4d')

    for (const page of ['action', 'options']) {
      expect(read(page, 'index.js')).not.toContain('SHARED_MARK_9c4d')
      expect(scriptSrcs(read(page, 'index.html'))).toEqual([
        '/probe-vendor.js',
        `/${page}/index.js`
      ])
    }
  }, 120_000)
})
