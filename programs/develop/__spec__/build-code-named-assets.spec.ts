import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQAB' +
    'h6FO1AAAAABJRU5ErkJggg==',
  'base64'
)
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project(background: string, files: Record<string, Buffer | string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-code-named-'))
  roots.push(root)

  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'code-named', version: '0.0.0'})
  )
  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'code-named',
      version: '1.0.0',
      action: {},
      background: {service_worker: 'background.js'}
    })
  )
  fs.writeFileSync(path.join(root, 'background.js'), background)

  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel)
    fs.mkdirSync(path.dirname(abs), {recursive: true})
    fs.writeFileSync(abs, content)
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

describe('files named only in code', () => {
  it('ships an icon set at runtime and a page opened by path', async () => {
    const root = project(
      [
        "chrome.action.setIcon({path: {16: 'img/logo/16x16.png', 38: 'img/logo/38x38.png'}})",
        "chrome.notifications.create('n', {type: 'basic', iconUrl: 'img/bell.png', title: 't', message: 'm'})",
        "chrome.tabs.create({url: 'changelog.html'})",
        ''
      ].join('\n'),
      {
        'img/logo/16x16.png': PNG,
        'img/logo/38x38.png': PNG,
        'img/bell.png': PNG,
        'changelog.html': '<!doctype html><html><body>changelog</body></html>'
      }
    )

    const summary = await build(root)
    expect(summary.errors_count).toBe(0)

    const distDir = path.join(root, 'dist', 'chrome')

    for (const rel of [
      'img/logo/16x16.png',
      'img/logo/38x38.png',
      'img/bell.png',
      'changelog.html'
    ]) {
      expect(fs.existsSync(path.join(distDir, rel)), rel).toBe(true)
    }
  }, 120_000)

  it('warns about an icon the code names and the build never produced', async () => {
    const root = project("chrome.action.setIcon({path: 'img/gone.png'})\n", {})

    const summary = await build(root)
    expect(summary.errors_count).toBe(0)

    const warnings = (summary.warnings || []).filter((text: string) =>
      text.includes('img/gone.png')
    )
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings[0]).toContain('at runtime')
    expect(
      fs.existsSync(path.join(root, 'dist', 'chrome', 'img', 'gone.png'))
    ).toBe(false)
  }, 120_000)
})
