import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-manifest-named-'))
  roots.push(root)
  fs.mkdirSync(path.join(root, 'lib'))
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'named', version: '0.0.0'})
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'named',
      version: '1.0.0',
      codename: 'release-2.1',
      homepage_url: 'https://example.com/index.html',
      background: {
        service_worker: 'sw.js',
        SW_scripts: ['/lib/a.js', '/lib/b.js']
      },
      scripts_for_popup_page: ['/lib/c.js', '/lib/nowhere.js'],
      content_scripts: [{matches: ['<all_urls>'], js: ['content.js']}]
    })
  )

  fs.writeFileSync(
    path.join(root, 'sw.js'),
    [
      'const scripts = chrome.runtime.getManifest().background.SW_scripts',
      'self.importScripts.apply(null, scripts)',
      ''
    ].join('\n')
  )

  fs.writeFileSync(path.join(root, 'lib', 'a.js'), 'var A = "a"\n')
  fs.writeFileSync(path.join(root, 'lib', 'b.js'), 'var B = A + "b"\n')
  fs.writeFileSync(path.join(root, 'lib', 'c.js'), 'var C = "c"\n')
  fs.writeFileSync(path.join(root, 'content.js'), 'console.log("content")\n')

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
      exitOnError: false
    } as any)

    expect(summary.errors_count).toBe(0)

    return summary
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
}

describe('files named under custom manifest keys ship with the build', () => {
  it('copies every existing file a custom key names and keeps the key verbatim', async () => {
    const root = project()
    const summary = await build(root)
    const dist = path.join(root, 'dist', 'chrome')

    for (const name of ['a', 'b', 'c']) {
      const emitted = path.join(dist, 'lib', `${name}.js`)
      expect(fs.existsSync(emitted), emitted).toBe(true)
      expect(fs.readFileSync(emitted, 'utf8')).toBe(
        fs.readFileSync(path.join(root, 'lib', `${name}.js`), 'utf8')
      )
    }

    const manifest = JSON.parse(
      fs.readFileSync(path.join(dist, 'manifest.json'), 'utf8')
    )
    expect(manifest.background.SW_scripts).toEqual(['/lib/a.js', '/lib/b.js'])
    expect(manifest.scripts_for_popup_page).toEqual([
      '/lib/c.js',
      '/lib/nowhere.js'
    ])

    // A string that names no file is data, not a dependency: no copy, no warning.
    expect(fs.existsSync(path.join(dist, 'lib', 'nowhere.js'))).toBe(false)
    expect(fs.existsSync(path.join(dist, 'release-2.1'))).toBe(false)
    const warnings = summary.warnings || []
    expect(warnings, warnings.join('\n---\n')).toHaveLength(0)

    // Strings under keys the browser defines keep their own pipeline: the
    // content script bundles and its source is not copied raw.
    expect(fs.existsSync(path.join(dist, 'content.js'))).toBe(false)
  }, 180_000)
})
