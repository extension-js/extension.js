import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

// The bundler forces splitChunks off, so a user cache group is the only way
// an entry ends up with several initial files. The HTML page then references
// one of them and renders blank under a green build: the build has to say so.
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project(chunks: 'all' | 'async') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-split-chunks-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'split-chunks', version: '0.0.0'})
  )
  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'split-chunks',
      version: '1.0.0',
      action: {default_popup: 'popup.html'},
      options_ui: {page: 'options.html'}
    })
  )
  fs.writeFileSync(
    path.join(root, 'shared.js'),
    'export function greet(name) {\n  return "hello " + name\n}\n'
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
    path.join(root, 'extension.config.js'),
    [
      'module.exports = {',
      '  config: (config) => ({',
      '    ...config,',
      '    optimization: {',
      '      ...config.optimization,',
      '      splitChunks: {',
      `        chunks: '${chunks}',`,
      '        cacheGroups: {',
      '          shared: {test: /shared\\.js$/, name: "shared", minSize: 0, enforce: true}',
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

function splitWarnings(summary: {warnings?: string[]}) {
  return (summary.warnings || []).filter((text) =>
    text.includes('initial files')
  )
}

describe('build warns when a user cache group splits an entry', () => {
  it('warns once per HTML entry and names the shared chunk file', async () => {
    const root = project('all')
    const summary = await build(root)
    expect(summary.errors_count).toBe(0)

    const distDir = path.join(root, 'dist', 'chrome')
    expect(fs.existsSync(path.join(distDir, 'shared.js'))).toBe(true)

    const warnings = splitWarnings(summary)
    expect(warnings).toHaveLength(2)
    const byEntry = Object.fromEntries(
      warnings.map((text) => [
        text.match(/([\w/]+) is split into/)?.[1] || text,
        text
      ])
    )
    expect(Object.keys(byEntry).sort()).toEqual([
      'action/index',
      'options/index'
    ])
    expect(byEntry['action/index']).toContain(
      'action/index.html references only action/index.js'
    )
    expect(byEntry['action/index']).toContain('NOT LOADED shared.js')
    expect(byEntry['options/index']).toContain(
      'options/index.html references only options/index.js'
    )
    expect(byEntry['options/index']).toContain('NOT LOADED shared.js')
    for (const text of warnings) {
      expect(text).toContain('the page renders blank')
      expect(text).toContain(
        'https://extension.js.org/docs/features/rspack-configuration#share-a-module-between-entries'
      )
    }
  }, 120_000)

  it('stays silent when the same cache group only targets async chunks', async () => {
    const root = project('async')
    const summary = await build(root)
    expect(summary.errors_count).toBe(0)

    const distDir = path.join(root, 'dist', 'chrome')
    expect(fs.existsSync(path.join(distDir, 'shared.js'))).toBe(false)
    expect(splitWarnings(summary)).toHaveLength(0)
  }, 120_000)
})
