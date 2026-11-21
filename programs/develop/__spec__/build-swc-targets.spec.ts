import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {buildProject} from './helpers/build-project'
import {trackTempFolders} from './helpers/temp-folders'

// A build compiles for one engine, so only that engine's declared floor may
// downlevel it. The worker below uses syntax a Firefox 42 or Chrome 30
// floor must rewrite, so a downleveled bundle is many times larger.
const WORKER = `class Store {
  #cache = new Map()
  async load(key) {
    const hit = this.#cache.get(key)
    return hit ?? (await fetch(\`/api/\${key}\`))?.json?.()
  }
}
const s = new Store()
export const boot = async () => {
  const cfg = {...(await s.load('cfg')), ready: true}
  for await (const k of ['a', 'b']) console.log(cfg?.[k] ?? 'none')
}
boot()
`
const GECKO = {gecko: {id: 'probe@ext', strict_min_version: '42.0'}}
const MODERN_MAX = 1000
const tempFolder = trackTempFolders()

function project(extra: Record<string, unknown>) {
  const root = tempFolder('extjs-swc-targets-')
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'targets', version: '0.0.0'})
  )

  fs.writeFileSync(path.join(root, 'background.js'), WORKER)
  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'targets-probe',
      version: '1.0.0',
      background: {service_worker: 'background.js'},
      ...extra
    })
  )

  return root
}

async function build(root: string, browser: 'firefox' | 'chrome') {
  const summary = await buildProject(root, {browser, mode: 'production'})
  expect(summary.errors_count).toBe(0)

  const distDir = path.join(root, 'dist', browser)
  const worker = fs.readFileSync(
    path.join(distDir, 'background', 'service_worker.js'),
    'utf8'
  )
  const manifest = JSON.parse(
    fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8')
  )

  return {worker, size: Buffer.byteLength(worker), manifest}
}

describe('swc targets follow the built browser', () => {
  it('keeps the chrome worker modern when only a firefox floor is declared', async () => {
    const {size, worker} = await build(
      project({browser_specific_settings: GECKO}),
      'chrome'
    )
    expect(size).toBeLessThan(MODERN_MAX)
    expect(worker).toMatch(/for await/)
  }, 120_000)

  it('downlevels the firefox worker for the vendor-prefixed gecko floor and ships the floor', async () => {
    const {size, worker, manifest} = await build(
      project({'firefox:browser_specific_settings': GECKO}),
      'firefox'
    )
    expect(size).toBeGreaterThan(MODERN_MAX)
    expect(worker).not.toMatch(/for await/)
    expect(manifest.browser_specific_settings.gecko.strict_min_version).toBe(
      '42.0'
    )
  }, 120_000)

  it('treats the plain gecko spelling the same as the prefixed one', async () => {
    const prefixed = await build(
      project({'firefox:browser_specific_settings': GECKO}),
      'firefox'
    )
    const plain = await build(
      project({browser_specific_settings: GECKO}),
      'firefox'
    )
    expect(plain.worker).toBe(prefixed.worker)
    expect(
      plain.manifest.browser_specific_settings.gecko.strict_min_version
    ).toBe('42.0')
  }, 120_000)

  it('keeps the chrome minimum downleveling the chrome worker', async () => {
    const {size} = await build(
      project({minimum_chrome_version: '30'}),
      'chrome'
    )
    expect(size).toBeGreaterThan(MODERN_MAX)
  }, 120_000)

  it('keeps the legacy applications.gecko spelling as the firefox floor', async () => {
    const {size} = await build(project({applications: GECKO}), 'firefox')
    expect(size).toBeGreaterThan(MODERN_MAX)
  }, 120_000)
})
