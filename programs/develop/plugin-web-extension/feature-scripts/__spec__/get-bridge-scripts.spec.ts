import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {
  getMainWorldBridgeScripts,
  resolveMainWorldBridgeSourcePath
} from '../steps/setup-reload-strategy/add-content-script-wrapper/get-bridge-scripts'

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
})
