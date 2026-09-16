import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {rspack} from '@rspack/core'
import {afterAll, describe, expect, it} from 'vitest'
import {getProjectStructure} from '../lib/project'
import webpackConfig from '../rspack-config'

// The dev build injects "tabs" so the reload loop works, and warns when the
// author's own code leans on it. A development bundle keeps every build-time
// branch, so the browser constant is substituted into the script but the
// branch it decides is still there, along with the function only that branch
// calls. This drives the real compiler to keep the scan honest about which of
// those two shapes the packaged extension would actually carry.
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

const SAFARI_ONLY = [
  'const isSafariLike =',
  "  import.meta.env.EXTENSION_PUBLIC_BROWSER === 'safari' ||",
  "  import.meta.env.EXTENSION_PUBLIC_BROWSER === 'webkit-based'",
  '',
  'function openSidebarTab() {',
  "  chrome.tabs.create({url: 'sidebar.html'}, () => {})",
  '}',
  '',
  'if (isSafariLike) {',
  '  openSidebarTab()',
  '}',
  ''
].join('\n')

const UNGUARDED = [
  'chrome.tabs.query({}, (tabs) => {',
  '  console.log(tabs.length)',
  '})',
  ''
].join('\n')

function project(background: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-dev-permission-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'sidebar', version: '0.0.0'})
  )

  fs.writeFileSync(path.join(root, 'background.ts'), background)
  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'sidebar',
      version: '1.0.0',
      browser_specific_settings: {gecko: {id: 'sidebar@example.com'}},
      background: {service_worker: 'background.ts'}
    })
  )

  return root
}

async function devCompile(background: string) {
  const root = project(background)
  const projectStructure = await getProjectStructure(root)
  // metadataCommand 'dev' is what makes this a dev session, which is the only
  // build that injects the permission and therefore the only one that warns.
  const config = webpackConfig(projectStructure, {
    browser: 'firefox',
    mode: 'development',
    metadataCommand: 'dev',
    silent: true,
    output: {clean: false, path: path.join(root, 'dist', 'firefox')}
  } as never)
  config.plugins = (config.plugins || []).filter(
    (plugin) =>
      plugin?.constructor.name !== 'plugin-browsers' &&
      plugin?.constructor.name !== 'plugin-playwright'
  )

  config.stats = false

  const compiler = rspack(config)
  const stats = await new Promise<any>((resolve, reject) =>
    compiler.run((error, result) => (error ? reject(error) : resolve(result)))
  )
  await new Promise<void>((resolve) => compiler.close(() => resolve()))

  const json = stats.toJson({warnings: true, errors: true})
  expect((json.errors || []).length).toBe(0)

  const bundle = path.join(
    root,
    'dist',
    'firefox',
    'background',
    'service_worker.js'
  )

  return {
    warnings: (json.warnings || [])
      .map((warning: unknown) =>
        typeof warning === 'string'
          ? warning
          : (warning as {message: string}).message
      )
      .filter((message: string) => /"tabs" permission/.test(message)),
    bundle: fs.existsSync(bundle) ? fs.readFileSync(bundle, 'utf-8') : ''
  }
}

describe('the dev-injected permission warning reads the emitted output', () => {
  it('stays quiet when the only chrome.tabs use is behind a Safari branch', async () => {
    const {warnings, bundle} = await devCompile(SAFARI_ONLY)

    // The development bundle really does still carry the call. The warning has
    // to look past that, or this whole test proves nothing.
    expect(bundle).toMatch(/chrome\s*\.\s*tabs/)
    expect(warnings).toEqual([])
  }, 120000)

  it('warns when the chrome.tabs call has no branch to compile it away', async () => {
    const {warnings} = await devCompile(UNGUARDED)

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('background.ts')
  }, 120000)
})
