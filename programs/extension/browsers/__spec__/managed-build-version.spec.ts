import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'
import {
  compareManagedBuildDirs,
  declaredManagedBuildVersion,
  MANAGED_FIREFOX_CHANNEL,
  managedBuildChannel,
  resolveManagedBinaryIn
} from '../browsers-lib/output-binaries-resolver'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

// The real shape on disk: the managed dir carries the version it was
// downloaded as, and the app bundle inside carries what it is now.
function geckoBuild(label: string, declared?: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-managed-'))
  roots.push(root)

  const dir = path.join(root, label)
  const resources = path.join(
    dir,
    'Firefox Nightly.app',
    'Contents',
    'Resources'
  )
  fs.mkdirSync(resources, {recursive: true})

  if (declared) {
    fs.writeFileSync(
      path.join(resources, 'application.ini'),
      `[App]\nName=Firefox\nVersion=${declared}\nBuildID=20260101\n`
    )
  }

  return dir
}

describe('ranking a managed build by what it is, not what it was named', () => {
  it('reads the version the install declares', () => {
    const dir = geckoBuild('mac_arm-nightly_158.0a1', '159.0a1')

    expect(declaredManagedBuildVersion(dir)).toEqual([159, 0, 1])
  })

  it('has no answer for a build that declares nothing', () => {
    const dir = geckoBuild('mac_arm-nightly_158.0a1')

    expect(declaredManagedBuildVersion(dir)).toBeUndefined()
  })

  it('ranks a self-updated build above a higher-labelled older one', () => {
    const updated = geckoBuild('mac_arm-nightly_158.0a1', '160.0a1')
    const older = geckoBuild('mac_arm-nightly_159.0a1', '159.0a1')

    expect(compareManagedBuildDirs(updated, older)).toBeGreaterThan(0)
    expect(compareManagedBuildDirs(older, updated)).toBeLessThan(0)
  })

  it('still orders by the label when neither build declares a version', () => {
    const low = geckoBuild('mac_arm-nightly_158.0a1')
    const high = geckoBuild('mac_arm-nightly_159.0a1')

    expect(compareManagedBuildDirs(high, low)).toBeGreaterThan(0)
  })

  it('compares a declared version against a label when only one has it', () => {
    const declared = geckoBuild('mac_arm-nightly_150.0a1', '161.0a1')
    const labelled = geckoBuild('mac_arm-nightly_160.0a1')

    expect(compareManagedBuildDirs(declared, labelled)).toBeGreaterThan(0)
  })

  it('keeps Chrome for Testing dirs ordered by their pinned labels', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-managed-'))
    roots.push(root)
    const older = path.join(root, 'mac_arm-151.0.7922.47')
    const newer = path.join(root, 'mac_arm-151.0.7922.71')
    fs.mkdirSync(older, {recursive: true})
    fs.mkdirSync(newer, {recursive: true})

    expect(compareManagedBuildDirs(newer, older)).toBeGreaterThan(0)
  })
})

describe('preferring the Firefox channel the installer pins', () => {
  const binaryName = process.platform === 'win32' ? 'firefox.exe' : 'firefox'

  function managedCache(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-channel-'))
    roots.push(root)

    return root
  }

  // A fake managed build: a runnable stub and the version it declares.
  function plantBuild(base: string, label: string, declared: string): string {
    const dir = path.join(base, 'firefox', label)
    fs.mkdirSync(dir, {recursive: true})
    fs.writeFileSync(
      path.join(dir, 'application.ini'),
      `[App]\nName=Firefox\nVersion=${declared}\n`
    )

    const binary = path.join(dir, binaryName)
    fs.writeFileSync(binary, '#!/bin/sh\necho "Mozilla Firefox"\n')
    fs.chmodSync(binary, 0o755)

    return binary
  }

  it('reads the channel off the folder label, then off the version shape', () => {
    expect(managedBuildChannel('mac_arm-nightly_158.0a1')).toBe('nightly')
    expect(managedBuildChannel('mac_arm-stable_150.0')).toBe('stable')
    expect(managedBuildChannel('linux-beta_151.0b3')).toBe('beta')
    expect(managedBuildChannel('win64-devedition_151.0b3')).toBe('devedition')
    expect(managedBuildChannel('linux-esr_140.5.0esr')).toBe('esr')
    expect(managedBuildChannel('mac_arm-158.0a1')).toBe('nightly')
    expect(managedBuildChannel('linux-151.0b3')).toBe('beta')
    expect(managedBuildChannel('linux-140.5.0esr')).toBe('esr')
    expect(managedBuildChannel('mac_arm-150.0')).toBe('stable')
  })

  it('pins the channel the installer downloads', () => {
    const runner = fs.readFileSync(
      path.resolve(__dirname, '../../../install/lib/runner.ts'),
      'utf8'
    )

    expect(runner).toContain(`'firefox@${MANAGED_FIREFOX_CHANNEL}'`)
  })

  it('runs the stable build when a nightly that updated itself sits beside it', () => {
    const base = managedCache()
    plantBuild(base, 'mac_arm-nightly_158.0a1', '160.0a1')
    const stable = plantBuild(base, 'mac_arm-stable_150.0', '150.0')

    expect(resolveManagedBinaryIn(base, 'firefox')).toBe(stable)
  })

  it('runs the newest stable build among several', () => {
    const base = managedCache()
    plantBuild(base, 'mac_arm-stable_149.0', '149.0')
    const newest = plantBuild(base, 'mac_arm-stable_150.0', '150.0.1')
    plantBuild(base, 'mac_arm-nightly_161.0a1', '161.0a1')

    expect(resolveManagedBinaryIn(base, 'firefox')).toBe(newest)
  })

  it('falls back to another channel only when no stable build is present', () => {
    const base = managedCache()
    plantBuild(base, 'mac_arm-nightly_157.0a1', '157.0a1')
    const nightly = plantBuild(base, 'mac_arm-nightly_158.0a1', '160.0a1')

    expect(resolveManagedBinaryIn(base, 'firefox')).toBe(nightly)
  })

  it('falls back when the stable folder holds no runnable binary', () => {
    const base = managedCache()
    const nightly = plantBuild(base, 'mac_arm-nightly_158.0a1', '160.0a1')
    fs.mkdirSync(path.join(base, 'firefox', 'mac_arm-stable_150.0'), {
      recursive: true
    })

    expect(resolveManagedBinaryIn(base, 'firefox')).toBe(nightly)
  })

  it('leaves the other browsers ranked by version alone', () => {
    const base = managedCache()
    const name = process.platform === 'win32' ? 'chrome.exe' : 'chrome'

    for (const label of ['mac_arm-150.0.7000.1', 'mac_arm-151.0.7100.2']) {
      const dir = path.join(base, 'chrome', label)
      fs.mkdirSync(dir, {recursive: true})
      fs.writeFileSync(path.join(dir, name), '#!/bin/sh\n')
      fs.chmodSync(path.join(dir, name), 0o755)
    }

    expect(resolveManagedBinaryIn(base, 'chrome')).toBe(
      path.join(base, 'chrome', 'mac_arm-151.0.7100.2', name)
    )
  })
})
