import fs from 'fs'
import os from 'os'
import path from 'path'
import {afterEach, describe, expect, it} from 'vitest'
import {
  getMainWorldBridgeScripts,
  resolveMainWorldBridgeSourcePath
} from './get-bridge-scripts'

const tempDirs = new Set<string>()

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extensionjs-bridge-'))
  tempDirs.add(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, {recursive: true, force: true})
  }
  tempDirs.clear()
})

describe('getMainWorldBridgeScripts', () => {
  it('returns a bridge entry for MAIN-world content scripts', () => {
    const root = makeTempDir()
    const manifestPath = path.join(root, 'manifest.json')

    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        content_scripts: [
          {matches: ['https://example.com/*'], js: ['a.js']},
          {
            matches: ['https://example.com/*'],
            js: ['b.js'],
            world: 'MAIN'
          }
        ]
      }),
      'utf8'
    )

    const bridgeScripts = getMainWorldBridgeScripts(manifestPath)
    const entries = Object.entries(bridgeScripts)

    expect(entries).toHaveLength(1)
    expect(entries[0]?.[0]).toBe('content_scripts/content-2')
    expect(entries[0]?.[1]).toMatch(/main-world-bridge\.js$/)
  })
})

describe('resolveMainWorldBridgeSourcePath', () => {
  it('resolves the compiled dist bridge artifact', () => {
    const packageRoot = makeTempDir()
    const distDir = path.join(packageRoot, 'dist')
    const bridgePath = path.join(distDir, 'main-world-bridge.cjs')

    fs.mkdirSync(distDir, {recursive: true})
    fs.writeFileSync(bridgePath, '// bridge', 'utf8')

    expect(
      resolveMainWorldBridgeSourcePath({
        lookupDir: distDir,
        packageRoot
      })
    ).toBe(bridgePath)
  })

  it('resolves the monorepo source-tree bridge fallback', () => {
    const packageRoot = makeTempDir()
    const lookupDir = path.join(packageRoot, 'dist')
    const bridgePath = path.join(
      packageRoot,
      'webpack/plugin-web-extension/feature-scripts/steps/setup-reload-strategy/add-content-script-wrapper/main-world-bridge.js'
    )

    fs.mkdirSync(path.dirname(bridgePath), {recursive: true})
    fs.mkdirSync(lookupDir, {recursive: true})
    fs.writeFileSync(bridgePath, '// bridge', 'utf8')

    expect(
      resolveMainWorldBridgeSourcePath({
        lookupDir,
        packageRoot
      })
    ).toBe(bridgePath)
  })
})
