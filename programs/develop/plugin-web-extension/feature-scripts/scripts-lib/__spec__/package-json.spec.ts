import fs from 'fs'
import os from 'os'
import path from 'path'
import {afterEach, describe, expect, it} from 'vitest'
import {findNearestPackageJsonSync} from '../package-json'

const tempRoots: string[] = []

afterEach(() => {
  while (tempRoots.length > 0) {
    const tempRoot = tempRoots.pop()
    if (!tempRoot) continue
    fs.rmSync(tempRoot, {recursive: true, force: true})
  }
})

function makeTempRoot(prefix: string): string {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tempRoots.push(tempRoot)
  return tempRoot
}

describe('feature-scripts package-json helper', () => {
  it('finds the nearest package.json from the manifest directory upward', () => {
    const root = makeTempRoot('extjs-feature-scripts-pkg-')
    const packageRoot = path.join(root, 'workspace')
    const manifestDir = path.join(packageRoot, 'examples', 'content', 'src')
    fs.mkdirSync(manifestDir, {recursive: true})

    const packageJsonPath = path.join(packageRoot, 'package.json')
    fs.writeFileSync(packageJsonPath, JSON.stringify({name: 'workspace'}))

    const manifestPath = path.join(manifestDir, 'manifest.json')
    fs.writeFileSync(manifestPath, '{}')

    expect(findNearestPackageJsonSync(manifestPath)).toBe(packageJsonPath)
  })

  it('returns null when no package.json exists above the manifest', () => {
    const root = makeTempRoot('extjs-feature-scripts-missing-pkg-')
    const manifestDir = path.join(root, 'nested', 'manifest')
    fs.mkdirSync(manifestDir, {recursive: true})

    const manifestPath = path.join(manifestDir, 'manifest.json')
    fs.writeFileSync(manifestPath, '{}')

    expect(findNearestPackageJsonSync(manifestPath)).toBeNull()
  })
})
