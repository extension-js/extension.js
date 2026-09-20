import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-root-refs-'))
  roots.push(root)
  fs.mkdirSync(path.join(root, 'views', 'about'), {recursive: true})
  fs.mkdirSync(path.join(root, 'assets', 'vendor'), {recursive: true})
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'root-refs', version: '0.0.0'})
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'root-refs',
      version: '1.0.0',
      action: {default_popup: '/views/about/about.html'}
    })
  )

  fs.writeFileSync(path.join(root, 'assets', 'arrows.gif'), 'GIF89a')
  fs.writeFileSync(
    path.join(root, 'assets', 'vendor', 'lib.js'),
    'window.LIB = 1\n'
  )

  fs.writeFileSync(
    path.join(root, 'views', 'about', 'about.html'),
    [
      '<!doctype html><html><head>',
      '<script src="/assets/vendor/lib.js"></script>',
      '</head><body>',
      '<img src="/assets/arrows.gif">',
      '<img src="/assets/missing.png">',
      '</body></html>'
    ].join('')
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

describe('a page that references files by root-absolute path', () => {
  it('ships each file once at its root path and names the project location when one is missing', async () => {
    const root = project()
    const summary = await build(root)
    const dist = path.join(root, 'dist', 'chrome')
    const files = fs
      .readdirSync(dist, {recursive: true})
      .map((file) => String(file).split(path.sep).join('/'))
      .filter((file) => fs.statSync(path.join(dist, file)).isFile())
      .sort()

    expect(files).toContain('assets/arrows.gif')
    expect(files).toContain('assets/vendor/lib.js')
    expect(files).not.toContain('assets/assets/arrows.gif')
    expect(files.filter((file) => file.endsWith('arrows.gif'))).toHaveLength(1)

    const page = fs.readFileSync(
      path.join(dist, 'action', 'index.html'),
      'utf8'
    )
    expect(page).toContain('src="/assets/arrows.gif"')
    expect(page).toContain('src="/assets/vendor/lib.js"')

    const warnings = (summary.warnings || []).map(String)
    const missing = warnings.filter((warning) =>
      warning.includes('assets/missing.png')
    )
    expect(missing, warnings.join('\n---\n')).toHaveLength(1)
    expect(missing[0]).toContain(path.join(root, 'assets', 'missing.png'))
    expect(missing[0]).not.toContain('.extension-build')
    expect(missing[0]).toContain('resolves from the extension root')
  }, 180_000)
})
