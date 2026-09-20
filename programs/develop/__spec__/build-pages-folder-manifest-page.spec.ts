import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

// A page under pages/ that the manifest also names. The folder scan used to
// enter it a second time, so it shipped twice and warned twice.
function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-pages-owned-'))
  roots.push(root)
  fs.mkdirSync(path.join(root, 'pages', 'about'), {recursive: true})
  fs.mkdirSync(path.join(root, 'pages', 'help'), {recursive: true})
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'pages-owned', version: '0.0.0'})
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'pages-owned',
      version: '1.0.0',
      action: {default_popup: '/pages/about/about.html'}
    })
  )

  fs.writeFileSync(
    path.join(root, 'pages', 'about', 'about.html'),
    [
      '<!doctype html><html><head></head><body>',
      '<img src="/assets/missing.png">',
      '</body></html>'
    ].join('')
  )

  fs.writeFileSync(
    path.join(root, 'pages', 'help', 'help.html'),
    '<!doctype html><html><body>help</body></html>'
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
      exitOnError: false
    } as any)

    expect(summary.errors_count).toBe(0)

    return summary
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
}

describe('a manifest page that lives under pages/', () => {
  it('ships once, warns once, and leaves the other pages/ files as entries', async () => {
    const root = project()
    const summary = await build(root)
    const dist = path.join(root, 'dist', 'chrome')
    const files = fs
      .readdirSync(dist, {recursive: true})
      .map((file) => String(file).split(path.sep).join('/'))
      .filter((file) => fs.statSync(path.join(dist, file)).isFile())
      .sort()

    expect(files).toContain('action/index.html')
    expect(files).not.toContain('pages/about/about.html')
    expect(files).toContain('pages/help/help.html')

    const warnings = (summary.warnings || []).map(String)
    const missing = warnings.filter((warning) =>
      warning.includes('assets/missing.png')
    )
    expect(missing, warnings.join('\n---\n')).toHaveLength(1)
  }, 180_000)
})
