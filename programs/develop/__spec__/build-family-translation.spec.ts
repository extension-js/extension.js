import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

// A manifest that names one key of a cross-browser pair has to reach the
// other vendor under the key that vendor reads, on the page the build emits.
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function stripAnsi(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\x1b\[[0-9;]*m/g, '')
}

function project(name: string, manifest: Record<string, unknown>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `extjs-${name}-`))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name, version: '0.0.0'})
  )

  fs.writeFileSync(path.join(root, 'background.js'), 'console.log("bg")\n')

  for (const page of ['panel', 'popup']) {
    fs.writeFileSync(
      path.join(root, `${page}.html`),
      `<!doctype html><title>${page}</title><script src="./${page}.js"></script>`
    )

    fs.writeFileSync(path.join(root, `${page}.js`), `console.log("${page}")\n`)
  }

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({name, version: '1.0.0', ...manifest})
  )

  return root
}

async function build(root: string, browser: 'chrome' | 'firefox') {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'
  const lines: string[] = []
  const originalLog = console.log
  const originalWarn = console.warn
  console.log = (...args: unknown[]) => lines.push(args.join(' '))
  console.warn = (...args: unknown[]) => lines.push(args.join(' '))
  let summary: {
    errors_count: number
    addon_lint?: {status: string; findings?: number}
  }

  try {
    summary = await extensionBuild(root, {
      browser,
      silent: false,
      install: false,
      mode: 'production',
      exitOnError: false
    } as never)
  } finally {
    console.log = originalLog
    console.warn = originalWarn
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }

  expect(summary.errors_count).toBe(0)
  const distDir = path.join(root, 'dist', browser)

  return {
    manifest: JSON.parse(
      fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8')
    ),
    output: stripAnsi(lines.join('\n')),
    summary,
    has: (rel: string) => fs.existsSync(path.join(distDir, rel))
  }
}

describe('cross-browser manifest translation at build time', () => {
  it('ships a sidebar_action-only manifest to chromium as side_panel', async () => {
    const root = project('sidebaronly', {
      manifest_version: 3,
      background: {service_worker: 'background.js'},
      sidebar_action: {default_panel: 'panel.html', default_title: 'Side'}
    })
    const {manifest, output, has} = await build(root, 'chrome')

    expect(manifest.side_panel).toEqual({default_path: 'sidebar/index.html'})
    expect(manifest).not.toHaveProperty('sidebar_action')
    expect(manifest.permissions).toEqual(['sidePanel'])
    expect(has('sidebar/index.html')).toBe(true)
    expect(output).toContain('side_panel')
  }, 180_000)

  it('ships a side_panel-only manifest to gecko as sidebar_action', async () => {
    const root = project('sidepanelonly', {
      manifest_version: 3,
      background: {service_worker: 'background.js'},
      side_panel: {default_path: 'panel.html'}
    })
    const {manifest, output, has} = await build(root, 'firefox')

    expect(manifest.sidebar_action).toEqual({
      default_panel: 'sidebar/index.html'
    })

    expect(manifest).not.toHaveProperty('side_panel')
    expect(has('sidebar/index.html')).toBe(true)
    expect(output).toContain('sidebar_action')
  }, 180_000)

  it('ships an MV3 action to a Manifest V2 gecko build as browser_action', async () => {
    const root = project('mv2action', {
      manifest_version: 3,
      'firefox:manifest_version': 2,
      browser_specific_settings: {gecko: {id: 'mv2action@example.com'}},
      background: {service_worker: 'background.js'},
      action: {default_popup: 'popup.html', default_title: 'Pop'}
    })
    const {manifest, output, summary, has} = await build(root, 'firefox')

    expect(manifest.manifest_version).toBe(2)
    expect(manifest.browser_action).toEqual({
      default_popup: 'action/index.html',
      default_title: 'Pop'
    })

    expect(manifest).not.toHaveProperty('action')
    expect(has('action/index.html')).toBe(true)

    // The AMO linter flagged "/action" on this exact shape before, so the
    // run has to be real for the absence below to mean anything.
    expect(summary.addon_lint).toEqual({status: 'linted', findings: 0})
    expect(output).not.toContain('MANIFEST_FIELD_UNSUPPORTED')
  }, 180_000)

  it('keeps the MV3 action on the chromium build of the same manifest', async () => {
    const root = project('mv2action-chromium', {
      manifest_version: 3,
      'firefox:manifest_version': 2,
      background: {service_worker: 'background.js'},
      action: {default_popup: 'popup.html'}
    })
    const {manifest} = await build(root, 'chrome')

    expect(manifest.manifest_version).toBe(3)
    expect(manifest.action.default_popup).toBe('action/index.html')
    expect(manifest).not.toHaveProperty('browser_action')
  }, 180_000)
})
