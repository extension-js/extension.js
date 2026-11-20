import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project(permissions: string[] = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-mv2-chromium-'))
  roots.push(root)

  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'mv2-chromium', version: '0.0.0'})
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 2,
      name: 'mv2-chromium',
      version: '1.0.0',
      description: 'A Manifest V2 fixture',
      browser_specific_settings: {gecko: {id: 'mv2@example.com'}},
      permissions,
      background: {scripts: ['background.js']}
    })
  )

  fs.writeFileSync(path.join(root, 'background.js'), 'console.log("mv2")\n')

  return root
}

async function manifestV2Warnings(
  root: string,
  browser: 'chrome' | 'edge' | 'brave' | 'firefox'
) {
  const {extensionBuild} = await import('../command-build')

  const summary = (await extensionBuild(root, {
    browser,
    silent: true,
    install: false,
    mode: 'production'
  } as any)) as {errors_count: number; warnings?: string[]}

  expect(summary.errors_count).toBe(0)

  return (summary.warnings || []).filter((text) =>
    text.includes('declares Manifest V2')
  )
}

describe('a Manifest V2 build for a Chromium target', () => {
  it('says once, by version, that Chrome no longer runs it', async () => {
    const warnings = await manifestV2Warnings(project(), 'chrome')

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('Chrome no longer runs it')
    expect(warnings[0]).toContain('Chrome 138 was the last version')
    expect(warnings[0]).toContain('Chrome 151 removed the flag')
    expect(warnings[0]).toContain('The chrome build will not install')
    expect(warnings[0]).not.toContain('webRequestBlocking')
  })

  it('tells an Edge build it is deprecated, not that it fails', async () => {
    const warnings = await manifestV2Warnings(project(), 'edge')

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('Microsoft Edge has deprecated')
    expect(warnings[0]).toContain('Edge 157 still loads and runs one unpacked')
    expect(warnings[0]).toContain('names no final version yet')
    expect(warnings[0]).not.toContain('with a warning to its users')
    expect(warnings[0]).not.toContain('will not install')
    expect(warnings[0]).not.toContain('no longer runs it')
  })

  it('names the Chromium version for a fork', async () => {
    const warnings = await manifestV2Warnings(project(), 'brave')

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('Chromium 151 removed the last flag')
    expect(warnings[0]).toContain('The brave build installs only where')
  })

  it('keeps the blocking webRequest note', async () => {
    const warnings = await manifestV2Warnings(
      project(['webRequest', 'webRequestBlocking']),
      'chrome'
    )

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('declarativeNetRequest')
  })

  it('says nothing on Firefox, which still runs it', async () => {
    expect(await manifestV2Warnings(project(), 'firefox')).toHaveLength(0)
  })
})
