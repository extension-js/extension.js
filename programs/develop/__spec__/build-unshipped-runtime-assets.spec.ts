import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

const roots: string[] = []
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
)

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function write(root: string, rel: string, contents: string | Buffer) {
  const file = path.join(root, rel)
  fs.mkdirSync(path.dirname(file), {recursive: true})
  fs.writeFileSync(file, contents)
}

function project(popupScript: string, files: Record<string, string | Buffer>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-runtime-assets-'))
  roots.push(root)

  write(
    root,
    'package.json',
    JSON.stringify({private: true, name: 'runtime-assets', version: '0.0.0'})
  )

  write(
    root,
    'manifest.json',
    JSON.stringify({
      manifest_version: 3,
      name: 'runtime-assets',
      version: '1.0.0',
      action: {default_popup: 'popup.html'}
    })
  )

  write(
    root,
    'popup.html',
    '<!doctype html><html><body><script src="./popup.js"></script></body></html>'
  )

  write(root, 'popup.js', popupScript)

  for (const [rel, contents] of Object.entries(files)) {
    write(root, rel, contents)
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

function unshipped(summary: {warnings?: string[]}) {
  return (summary.warnings || []).filter((text) =>
    /at runtime, but \d+ files? in /.test(text)
  )
}

describe('runtime paths whose files are not in the build', () => {
  it('names a folder held as string constants', async () => {
    const root = project(
      [
        'const providers = [',
        "  {name: 'chatgpt', icon: '/icons/providers/chatgpt.png'},",
        "  {name: 'claude', icon: '/icons/providers/claude.png'}",
        ']',
        'for (const p of providers) {',
        "  const img = document.createElement('img')",
        '  img.src = p.icon',
        '  document.body.append(img)',
        '}'
      ].join('\n'),
      {
        'icons/providers/chatgpt.png': PNG,
        'icons/providers/claude.png': PNG
      }
    )

    const summary = await build(root)
    const warnings = unshipped(summary)

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('icons/providers/')
    expect(warnings[0]).toContain('public/icons/providers/')
    expect(warnings[0]).toMatch(/2 files/)
  }, 120_000)

  it('names a folder used as a prefix in a built path', async () => {
    const root = project(
      [
        "const name = location.hash.slice(1) || 'kimi'",
        "const img = document.createElement('img')",
        "img.src = chrome.runtime.getURL('icons/providers/' + name + '.png')",
        'document.body.append(img)'
      ].join('\n'),
      {'icons/providers/kimi.png': PNG}
    )

    const warnings = unshipped(await build(root))

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('icons/providers/')
  }, 120_000)

  it('names a folder used as a template literal head', async () => {
    const root = project(
      [
        "const theme = location.hash.slice(1) || 'dark'",
        "const img = document.createElement('img')",
        'img.src = `assets/images/\u0024{theme}.png`',
        'document.body.append(img)'
      ].join('\n'),
      {'assets/images/dark.png': PNG, 'assets/images/light.png': PNG}
    )

    const warnings = unshipped(await build(root))

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('assets/images/')
  }, 120_000)

  it('stays quiet when the folder is in public/', async () => {
    const root = project(
      [
        "const name = location.hash.slice(1) || 'kimi'",
        "const img = document.createElement('img')",
        "img.src = '/icons/providers/' + name + '.png'",
        'document.body.append(img)'
      ].join('\n'),
      {'public/icons/providers/kimi.png': PNG}
    )

    const summary = await build(root)

    expect(unshipped(summary)).toEqual([])
    expect(
      fs.existsSync(
        path.join(root, 'dist', 'chrome', 'icons', 'providers', 'kimi.png')
      )
    ).toBe(true)
  }, 120_000)

  it('stays quiet for an imported asset and a literal getURL', async () => {
    const root = project(
      [
        "import logo from './images/logo.png'",
        "const a = document.createElement('img')",
        'a.src = logo',
        "const b = document.createElement('img')",
        "b.src = chrome.runtime.getURL('icons/badge.png')",
        'document.body.append(a, b)'
      ].join('\n'),
      {'images/logo.png': PNG, 'icons/badge.png': PNG}
    )

    expect(unshipped(await build(root))).toEqual([])
  }, 120_000)
})
