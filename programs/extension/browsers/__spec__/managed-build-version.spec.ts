import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'
import {
  compareManagedBuildDirs,
  declaredManagedBuildVersion
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
