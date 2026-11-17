import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {
  getMainWorldBridgePairs,
  getMainWorldBridgeScripts,
  resolveMainWorldBridgeSourcePath
} from '../steps/add-content-script-wrapper/get-bridge-scripts'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, {recursive: true, force: true})
  }
})

function createTempDir(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tempDirs.push(dir)

  return dir
}

describe('main-world bridge helpers', () => {
  it('resolves the published dist bridge file when provided a package root', () => {
    const packageRoot = createTempDir('extjs-bridge-root-')
    const distDir = path.join(packageRoot, 'dist')
    fs.mkdirSync(distDir, {recursive: true})

    const bridgePath = path.join(distDir, 'main-world-bridge.js')
    fs.writeFileSync(
      bridgePath,
      'export default function bridge() {}\n',
      'utf8'
    )

    expect(
      resolveMainWorldBridgeSourcePath({
        lookupDir: path.join(packageRoot, 'somewhere'),
        packageRoot
      })
    ).toBe(bridgePath)
  })

  it('creates bridge entries only for MAIN world content scripts', () => {
    const projectDir = createTempDir('extjs-bridge-manifest-')
    const srcDir = path.join(projectDir, 'src')
    const distDir = path.join(projectDir, 'dist')
    fs.mkdirSync(srcDir, {recursive: true})
    fs.mkdirSync(distDir, {recursive: true})

    fs.writeFileSync(
      path.join(projectDir, 'package.json'),
      '{"name":"fixture"}\n'
    )

    fs.writeFileSync(
      path.join(distDir, 'main-world-bridge.js'),
      'export default function bridge() {}\n',
      'utf8'
    )

    const manifestPath = path.join(srcDir, 'manifest.json')
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        manifest_version: 3,
        content_scripts: [
          {
            matches: ['<all_urls>'],
            js: ['content/isolated.js']
          },
          {
            matches: ['<all_urls>'],
            js: ['content/main.js'],
            world: 'MAIN'
          }
        ]
      }),
      'utf8'
    )

    const bridgeScripts = getMainWorldBridgeScripts(manifestPath)

    expect(Object.keys(bridgeScripts)).toEqual(['content_scripts/content-2'])
    expect(
      path.basename(String(bridgeScripts['content_scripts/content-2']))
    ).toBe('main-world-bridge.js')
  })

  it('resolves browser-prefixed world keys before scanning (bug 42)', () => {
    const projectDir = createTempDir('extjs-bridge-prefixed-')
    const srcDir = path.join(projectDir, 'src')
    const distDir = path.join(projectDir, 'dist')
    fs.mkdirSync(srcDir, {recursive: true})
    fs.mkdirSync(distDir, {recursive: true})

    fs.writeFileSync(
      path.join(projectDir, 'package.json'),
      '{"name":"fixture"}\n'
    )

    fs.writeFileSync(
      path.join(distDir, 'main-world-bridge.js'),
      'export default function bridge() {}\n',
      'utf8'
    )

    const manifestPath = path.join(srcDir, 'manifest.json')
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        manifest_version: 3,
        content_scripts: [
          {
            matches: ['<all_urls>'],
            js: ['content/main.js'],
            'chromium:world': 'MAIN'
          }
        ]
      }),
      'utf8'
    )

    for (const browser of ['chrome', 'edge', 'chromium-based'] as const) {
      const bridgeScripts = getMainWorldBridgeScripts(manifestPath, browser)
      expect(Object.keys(bridgeScripts)).toEqual(['content_scripts/content-1'])
    }

    expect(
      Object.keys(getMainWorldBridgeScripts(manifestPath, 'firefox'))
    ).toEqual([])
  })

  it('gives no bridge and says nothing when the manifest does not parse', () => {
    // Pins today's behavior. Ledger 1384 D8.
    const manifestPath = path.join(
      createTempDir('extjs-bridge-unparsed-'),
      'manifest.json'
    )
    const main = JSON.stringify({
      manifest_version: 3,
      content_scripts: [
        {matches: ['<all_urls>'], js: ['main.js'], world: 'MAIN'}
      ]
    })
    const said = (['log', 'info', 'warn', 'error'] as const).map((name) =>
      vi.spyOn(console, name).mockImplementation(() => {})
    )

    try {
      fs.writeFileSync(manifestPath, main)
      expect(Object.keys(getMainWorldBridgeScripts(manifestPath))).toEqual([
        'content_scripts/content-1'
      ])

      // The same manifest cut short, as an editor leaves it mid-save.
      fs.writeFileSync(manifestPath, main.slice(0, -2))
      expect(getMainWorldBridgeScripts(manifestPath)).toEqual({})
      expect(getMainWorldBridgePairs(manifestPath)).toEqual([])
      expect(said.map((spy) => spy.mock.calls.length)).toEqual([0, 0, 0, 0])
    } finally {
      for (const spy of said) spy.mockRestore()
    }
  })
})
