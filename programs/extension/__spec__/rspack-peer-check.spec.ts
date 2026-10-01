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
  describeUnreadableDependencies,
  engineRspackVersion,
  remedyRspackPeerConflicts,
  scanRspackPeers
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

    // A copy whose version is not a release number falls back to the pin.
    // Written on purpose: a bare folder could still resolve some @rspack/core
    // from a parent directory on a CI runner.
    writePackage(engine, '@rspack/core', {version: 'workspace'})
    expect(engineRspackVersion('/any')).toBe('2.2.0')

    writePackage(engine, '@rspack/core', {version: '2.2.3'})
    expect(engineRspackVersion('/any')).toBe('2.2.3')

    developRoot.dir = ''
    expect(engineRspackVersion('/any')).toBeUndefined()
  })

  it('names css-loader 6, reports the unreadable one and leaves a widened css-loader 7 and peerless packages alone', () => {
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

    const {conflicts, unreadable} = scanRspackPeers(root, '2.2.3')

    expect(conflicts).toEqual([
      {name: 'css-loader', version: '6.11.0', range: '0.x || 1.x'}
    ])

    expect(unreadable).toEqual(['not-installed'])

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

    expect(scanRspackPeers(root, '2.2.3').conflicts).toEqual([])
  })

  it('names css-loader from its declared range when nothing is installed', () => {
    const root = project({'css-loader': '^6.11.0', extension: '^4.1.30'})

    const scan = scanRspackPeers(root, '2.2.3')

    expect(scan).toEqual({
      conflicts: [{name: 'css-loader', declared: '^6.11.0', fixedIn: '7.1.4'}],
      unreadable: ['extension']
    })

    expect(describeRspackPeerConflicts(scan.conflicts, '2.2.3')).toBe(
      'css-loader ^6.11.0 is declared but not installed and stays below 7.1.4, the first release whose peer range accepts @rspack/core 2.x (the engine ships 2.2.3)'
    )

    expect(remedyRspackPeerConflicts(scan.conflicts, '2.2.3')).toBe(
      'Upgrade css-loader to 7.1.4 or newer, its peer range accepts @rspack/core 2, then install again'
    )

    expect(describeUnreadableDependencies(scan.unreadable)).toBe(
      'could not read 1 direct dependency (extension), its @rspack/core peer range is unverified'
    )
  })

  it('reports a declared range that can reach the known fix as unreadable, not clear', () => {
    const root = project({'css-loader': '^7.1.4', 'postcss-loader': '^8.0.0'})

    expect(scanRspackPeers(root, '2.2.3')).toEqual({
      conflicts: [],
      unreadable: ['css-loader', 'postcss-loader']
    })

    expect(
      describeUnreadableDependencies(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])
    ).toBe(
      'could not read 8 direct dependencies (a, b, c, d, e, f and 2 more), their @rspack/core peer ranges are unverified'
    )
  })

  it('still reads a package whose exports map hides package.json', () => {
    const root = project({'strict-loader': '^1.0.0'})
    writePackage(root, 'strict-loader', {
      version: '1.0.0',
      exports: {'.': './index.js'},
      peerDependencies: {'@rspack/core': '^1.0.0'}
    })

    expect(scanRspackPeers(root, '2.2.3')).toEqual({
      conflicts: [{name: 'strict-loader', version: '1.0.0', range: '^1.0.0'}],
      unreadable: []
    })
  })

  it('does not claim the known fix for an engine major it was not measured against', () => {
    const root = project({'css-loader': '^6.11.0'})

    expect(scanRspackPeers(root, '3.0.0')).toEqual({
      conflicts: [],
      unreadable: ['css-loader']
    })

    writePackage(root, 'css-loader', {
      version: '7.1.4',
      peerDependencies: {'@rspack/core': '0.x || ^1.0.0 || ^2.0.0-0'}
    })

    const {conflicts} = scanRspackPeers(root, '3.0.0')

    expect(conflicts).toEqual([
      {name: 'css-loader', version: '7.1.4', range: '0.x || ^1.0.0 || ^2.0.0-0'}
    ])

    expect(remedyRspackPeerConflicts(conflicts, '3.0.0')).toBe(
      'Upgrade css-loader to a release whose @rspack/core peer range accepts 3.x, then install again'
    )
  })

  it('gives a generic upgrade line for a package with no known fix', () => {
    const conflicts = [{name: 'some-loader', version: '1.0.0', range: '^1.0.0'}]

    expect(remedyRspackPeerConflicts(conflicts, '2.2.3')).toBe(
      'Upgrade some-loader to a release whose @rspack/core peer range accepts 2.x, then install again'
    )
  })

  it('returns nothing for a folder without a package.json', () => {
    expect(scanRspackPeers(tempDir('extjs-empty-'), '2.2.3')).toEqual({
      conflicts: [],
      unreadable: []
    })
  })
})
