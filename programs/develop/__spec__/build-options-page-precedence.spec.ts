import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

// Both engines read options_ui.page first and treat options_page as the
// fallback, so the one compiled options page must come from the modern key.
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

const LEGACY_MARK = 'LEGACY_OPTIONS_MARK_4d1b'
const MODERN_MARK = 'MODERN_OPTIONS_MARK_8e7c'

function project(manifestExtra: Record<string, unknown>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-options-page-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'options-page', version: '0.0.0'})
  )
  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'options-page',
      version: '1.0.0',
      ...manifestExtra
    })
  )
  const marks: Record<string, string> = {
    legacy: LEGACY_MARK,
    modern: MODERN_MARK
  }
  for (const which of ['legacy', 'modern']) {
    fs.writeFileSync(
      path.join(root, `${which}-options.html`),
      `<html><body><div id="root"></div><script type="module" src="./${which}-options.js"></script></body></html>\n`
    )
    fs.writeFileSync(
      path.join(root, `${which}-options.js`),
      `document.getElementById('root').textContent = '${marks[which]}'\n`
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

async function buildAndRead(manifestExtra: Record<string, unknown>) {
  const root = project(manifestExtra)
  const summary: any = await build(root)
  expect(summary.errors_count).toBe(0)
  const distDir = path.join(root, 'dist', 'chrome')
  return {
    distDir,
    manifest: JSON.parse(
      fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8')
    ),
    script: fs.readFileSync(path.join(distDir, 'options', 'index.js'), 'utf8')
  }
}

function htmlFilesUnder(distDir: string, folder: string) {
  const dir = path.join(distDir, folder)
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.html'))
    .sort()
}

describe('options page precedence', () => {
  it('builds the modern source when both keys name different files', async () => {
    const {distDir, manifest, script} = await buildAndRead({
      options_page: 'legacy-options.html',
      options_ui: {page: 'modern-options.html', open_in_tab: false}
    })

    expect(script).toContain(MODERN_MARK)
    expect(script).not.toContain(LEGACY_MARK)
    expect(manifest.options_ui.page).toBe('options/index.html')
    expect(manifest.options_ui.open_in_tab).toBe(false)
    expect(manifest.options_page).toBe('options/index.html')
    expect(htmlFilesUnder(distDir, 'options')).toEqual(['index.html'])
  }, 120_000)

  it('keeps building the legacy source when it is the only key', async () => {
    const {distDir, manifest, script} = await buildAndRead({
      options_page: 'legacy-options.html'
    })

    expect(script).toContain(LEGACY_MARK)
    expect(manifest.options_page).toBe('options/index.html')
    expect(manifest.options_ui).toBeUndefined()
    expect(htmlFilesUnder(distDir, 'options')).toEqual(['index.html'])
  }, 120_000)

  it('builds the modern source when it is the only key', async () => {
    const {manifest, script} = await buildAndRead({
      options_ui: {page: 'modern-options.html'}
    })

    expect(script).toContain(MODERN_MARK)
    expect(manifest.options_ui.page).toBe('options/index.html')
    expect(manifest.options_page).toBeUndefined()
  }, 120_000)

  it('emits one page when both keys name the same file', async () => {
    const {distDir, manifest, script} = await buildAndRead({
      options_page: 'modern-options.html',
      options_ui: {page: './modern-options.html', open_in_tab: true}
    })

    expect(script).toContain(MODERN_MARK)
    expect(manifest.options_page).toBe('options/index.html')
    expect(manifest.options_ui.page).toBe('options/index.html')
    expect(htmlFilesUnder(distDir, 'options')).toEqual(['index.html'])
    const emittedScripts = fs
      .readdirSync(path.join(distDir, 'options'))
      .filter((name) => name.endsWith('.js'))
    expect(emittedScripts).toEqual(['index.js'])
  }, 120_000)
})
