import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'
import {buildProject} from './helpers/build-project'

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
  const lines: string[] = []
  const originalLog = console.log
  const originalWarn = console.warn
  console.log = (...args: unknown[]) => lines.push(args.join(' '))
  console.warn = (...args: unknown[]) => lines.push(args.join(' '))
  let summary: {
    errors_count: number
    warnings_count?: number
    addon_lint?: {status: string; findings?: number}
  }

  try {
    summary = await buildProject(root, {
      browser,
      silent: false,
      mode: 'production'
    })
  } finally {
    console.log = originalLog
    console.warn = originalWarn
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
    expect(output).toContain('The build folded sidebar_action into side_panel')
    expect(output).not.toContain('never opens')
  }, 180_000)

  it('ships a side_panel-only manifest to gecko as sidebar_action', async () => {
    const root = project('sidepanelonly', {
      manifest_version: 3,
      // A complete Gecko identity, so the store check has nothing to say and
      // the warning count below speaks for the sidebar alone.
      browser_specific_settings: {
        gecko: {
          id: 'sidepanelonly@example.com',
          data_collection_permissions: {required: ['none']}
        }
      },
      background: {service_worker: 'background.js'},
      side_panel: {default_path: 'panel.html'}
    })
    const {manifest, output, summary, has} = await build(root, 'firefox')

    expect(manifest.sidebar_action).toEqual({
      default_panel: 'sidebar/index.html'
    })

    expect(manifest).not.toHaveProperty('side_panel')
    expect(has('sidebar/index.html')).toBe(true)

    // The fold worked, so the build says so in a note and raises no warning
    // that claims the panel never opens.
    expect(output).toContain('The build folded side_panel into sidebar_action')
    expect(output).not.toContain('never opens')
    expect(summary.warnings_count ?? 0, output).toBe(0)
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

describe('a Chrome-only manifest built for Firefox', () => {
  const identity = (id: string) => ({
    browser_specific_settings: {
      gecko: {id, data_collection_permissions: {required: ['none']}}
    }
  })
  const moved =
    'The build moved background.service_worker into background.scripts for firefox'

  it('ports the worker, the panel and the permission and names each one', async () => {
    const root = project('chromeonly', {
      manifest_version: 3,
      ...identity('chromeonly@example.com'),
      background: {service_worker: 'background.js'},
      side_panel: {default_path: 'panel.html'},
      permissions: ['sidePanel', 'storage']
    })
    const {manifest, output, summary, has} = await build(root, 'firefox')

    expect(manifest.background).toEqual({
      scripts: ['background/service_worker.js']
    })

    expect(has('background/service_worker.js')).toBe(true)
    expect(manifest.sidebar_action).toEqual({
      default_panel: 'sidebar/index.html'
    })

    expect(manifest).not.toHaveProperty('side_panel')
    expect(manifest.permissions).toEqual(['storage'])

    expect(output.split(moved)).toHaveLength(2)
    expect(output).toContain('firefox:background')
    expect(output).toContain('The build folded side_panel into sidebar_action')
    expect(output).toContain('Firefox has no support for permissions.sidePanel')
    // Each repair ran, so the build stays green and raises no warning.
    expect(summary.warnings_count ?? 0, output).toBe(0)
  }, 180_000)

  it('says nothing about the worker when a firefox:background key supplies scripts', async () => {
    const root = project('geckooverride', {
      manifest_version: 3,
      ...identity('geckooverride@example.com'),
      background: {service_worker: 'background.js'},
      'firefox:background': {scripts: ['background.js']}
    })
    const {manifest, output} = await build(root, 'firefox')

    expect(manifest.background.scripts).toHaveLength(1)
    expect(manifest.background).not.toHaveProperty('service_worker')
    expect(output).not.toContain(moved)
  }, 180_000)

  it('says nothing about the worker when scripts sits beside it', async () => {
    const root = project('bothforms', {
      manifest_version: 3,
      ...identity('bothforms@example.com'),
      background: {service_worker: 'background.js', scripts: ['background.js']}
    })
    const {manifest, output} = await build(root, 'firefox')

    expect(manifest.background.scripts).toHaveLength(1)
    expect(output).not.toContain(moved)
  }, 180_000)

  it('says nothing about the worker on a chromium build', async () => {
    const root = project('chromeworker', {
      manifest_version: 3,
      background: {service_worker: 'background.js'}
    })
    const {manifest, output} = await build(root, 'chrome')

    expect(manifest.background.service_worker).toBe(
      'background/service_worker.js'
    )

    expect(output).not.toContain('The build moved background.service_worker')
  }, 180_000)
})
