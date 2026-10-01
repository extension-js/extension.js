import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-runtime-chunk-'))
  roots.push(root)

  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'runtime-chunk', version: '0.0.0'})
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'runtime-chunk',
      version: '1.0.0',
      action: {default_popup: 'popup.html'},
      options_ui: {page: 'options.html'},
      background: {service_worker: 'background.js'},
      content_scripts: [{matches: ['<all_urls>'], js: ['content.js']}]
    })
  )

  fs.writeFileSync(
    path.join(root, 'shared.js'),
    'export const shared = "SHARED_MARK_3b8e"\n'
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

  fs.writeFileSync(
    path.join(root, 'extension.config.js'),
    [
      'module.exports = {',
      '  config: (config) => ({',
      '    ...config,',
      "    optimization: {...config.optimization, runtimeChunk: 'single'}",
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

describe('a user runtimeChunk setting', () => {
  it('keeps the runtime inside the background and the content script', async () => {
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

    expect(fs.existsSync(path.join(distDir, 'runtime.js'))).toBe(false)

    for (const file of [
      ['background', 'service_worker.js'],
      ['content_scripts', 'content-0.js']
    ]) {
      const bundle = read(...file)
      expect(bundle).toContain('SHARED_MARK_3b8e')
      expect(bundle).not.toContain('rspackChunk')
    }

    expect(read('shared', 'commons.js')).toContain('SHARED_MARK_3b8e')
  }, 120_000)
})
