import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'

const developRoot = vi.hoisted(() => ({dir: ''}))

vi.mock('../helpers/extension-develop-runtime', () => ({
  resolveExtensionDevelopRoot: () => {
    if (!developRoot.dir) throw new Error('no engine')

    return developRoot.dir
  }
}))

import {
  describeRspackPeerConflicts,
  engineRspackVersion,
  findRspackPeerConflicts,
  remedyRspackPeerConflicts
} from '../helpers/rspack-peer-check'

const created: string[] = []

function tempDir(prefix: string) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)))
  created.push(dir)

  return dir
}

function writePackage(root: string, name: string, manifest: object) {
  const dir = path.join(root, 'node_modules', ...name.split('/'))
  fs.mkdirSync(dir, {recursive: true})
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({name, main: 'index.js', ...manifest})
  )

  fs.writeFileSync(path.join(dir, 'index.js'), '')
}

function project(deps: Record<string, string>) {
  const root = tempDir('extjs-peer-')
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({name: 'p', devDependencies: deps})
  )

  return root
}

afterEach(() => {
  developRoot.dir = ''

  for (const dir of created.splice(0)) {
    fs.rmSync(dir, {recursive: true, force: true})
  }
})

describe('the @rspack/core peer check', () => {
  it('reads the engine version from the installed @rspack/core, else the pin', () => {
    const engine = tempDir('extjs-engine-')
    fs.writeFileSync(
      path.join(engine, 'package.json'),
      JSON.stringify({
        name: 'extension-develop',
        dependencies: {'@rspack/core': '^2.2.0'}
      })
    )

    developRoot.dir = engine

    expect(engineRspackVersion('/any')).toBe('2.2.0')

    writePackage(engine, '@rspack/core', {version: '2.2.3'})
    expect(engineRspackVersion('/any')).toBe('2.2.3')

    developRoot.dir = ''
    expect(engineRspackVersion('/any')).toBeUndefined()
  })

  it('names css-loader 6 and leaves a widened css-loader 7 and peerless packages alone', () => {
    const root = project({
      'css-loader': '^6.11.0',
      'postcss-loader': '^8.0.0',
      'not-installed': '1.0.0'
    })
    writePackage(root, 'css-loader', {
      version: '6.11.0',
      peerDependencies: {webpack: '^5.0.0', '@rspack/core': '0.x || 1.x'},
      peerDependenciesMeta: {'@rspack/core': {optional: true}}
    })

    writePackage(root, 'postcss-loader', {
      version: '8.2.1',
      peerDependencies: {postcss: '^8'}
    })

    const conflicts = findRspackPeerConflicts(root, '2.2.3')

    expect(conflicts).toEqual([
      {name: 'css-loader', version: '6.11.0', range: '0.x || 1.x'}
    ])

    expect(describeRspackPeerConflicts(conflicts, '2.2.3')).toBe(
      'css-loader 6.11.0 accepts @rspack/core 0.x || 1.x, the engine ships 2.2.3'
    )

    expect(remedyRspackPeerConflicts(conflicts, '2.2.3')).toBe(
      'Upgrade css-loader to 7.1.4 or newer, its peer range accepts @rspack/core 2, then install again'
    )

    writePackage(root, 'css-loader', {
      version: '7.1.4',
      peerDependencies: {
        webpack: '^5.27.0',
        '@rspack/core': '0.x || ^1.0.0 || ^2.0.0-0'
      }
    })

    expect(findRspackPeerConflicts(root, '2.2.3')).toEqual([])
  })

  it('gives a generic upgrade line for a package with no known fix', () => {
    const conflicts = [{name: 'some-loader', version: '1.0.0', range: '^1.0.0'}]

    expect(remedyRspackPeerConflicts(conflicts, '2.2.3')).toBe(
      'Upgrade some-loader to a release whose @rspack/core peer range accepts 2.x, then install again'
    )
  })

  it('returns nothing for a folder without a package.json', () => {
    expect(findRspackPeerConflicts(tempDir('extjs-empty-'), '2.2.3')).toEqual(
      []
    )
  })
})
