import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {
  DIST_STAGING_PREFIX,
  promoteStagingDist,
  removeStagingDir,
  removeStaleStagingDirs,
  stagingDistPathFor
} from '../atomic-dist'

let root: string
let distPath: string

function writeTree(dir: string, files: Record<string, string>) {
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(dir, relative)
    fs.mkdirSync(path.dirname(target), {recursive: true})
    fs.writeFileSync(target, content)
  }
}

function listNames(dir: string): string[] {
  try {
    return fs.readdirSync(dir).sort()
  } catch {
    return []
  }
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-atomic-dist-'))
  distPath = path.join(root, 'dist', 'chrome')
})

afterEach(() => {
  fs.rmSync(root, {recursive: true, force: true})
})

describe('lib/atomic-dist', () => {
  it('creates staging paths as hidden siblings scoped to the browser dir', () => {
    const staging = stagingDistPathFor(distPath)
    expect(path.dirname(staging)).toBe(path.join(root, 'dist'))
    expect(
      path.basename(staging).startsWith(`${DIST_STAGING_PREFIX}chrome-`)
    ).toBe(true)
    expect(staging).not.toBe(stagingDistPathFor(distPath))
  })

  it('promotes a finished staging dir wholesale, replacing the old dist', () => {
    writeTree(distPath, {
      'manifest.json': '{"old":true}',
      'stale-bundle.js': 'old'
    })
    const staging = stagingDistPathFor(distPath)
    writeTree(staging, {
      'manifest.json': '{"new":true}',
      'action/index.html': '<html></html>'
    })

    promoteStagingDist(staging, distPath)

    expect(fs.readFileSync(path.join(distPath, 'manifest.json'), 'utf-8')).toBe(
      '{"new":true}'
    )
    expect(fs.existsSync(path.join(distPath, 'action/index.html'))).toBe(true)
    // Stale files from the previous build must not survive the swap.
    expect(fs.existsSync(path.join(distPath, 'stale-bundle.js'))).toBe(false)
    // No staging or retired litter remains next to the published dist.
    expect(listNames(path.join(root, 'dist'))).toEqual(['chrome'])
  })

  it('promotes on a first build with no previous dist', () => {
    const staging = stagingDistPathFor(distPath)
    writeTree(staging, {'manifest.json': '{"v":1}'})

    promoteStagingDist(staging, distPath)

    expect(fs.existsSync(path.join(distPath, 'manifest.json'))).toBe(true)
    expect(listNames(path.join(root, 'dist'))).toEqual(['chrome'])
  })

  it('keeps the previous dist when the promote itself fails', () => {
    writeTree(distPath, {
      'manifest.json': '{"old":true}',
      'popup.html': 'page'
    })
    const staging = stagingDistPathFor(distPath)

    expect(() => promoteStagingDist(staging, distPath)).toThrow()

    expect(fs.readFileSync(path.join(distPath, 'manifest.json'), 'utf-8')).toBe(
      '{"old":true}'
    )
    expect(fs.existsSync(path.join(distPath, 'popup.html'))).toBe(true)
    expect(listNames(path.join(root, 'dist'))).toEqual(['chrome'])
  })

  it('an interrupted build (staging never promoted) leaves dist untouched', () => {
    writeTree(distPath, {
      'manifest.json': '{"good":true}',
      'action/index.html': 'page'
    })
    const staging = stagingDistPathFor(distPath)
    // The interrupt happened mid-emit: manifest present, pages missing.
    writeTree(staging, {'manifest.json': '{"partial":true}'})

    expect(fs.readFileSync(path.join(distPath, 'manifest.json'), 'utf-8')).toBe(
      '{"good":true}'
    )

    removeStaleStagingDirs(distPath)
    expect(listNames(path.join(root, 'dist'))).toEqual(['chrome'])
  })

  it('sweeps only staging dirs that belong to this browser target', () => {
    writeTree(distPath, {'manifest.json': '{}'})
    const mine = `${DIST_STAGING_PREFIX}chrome-dead1`
    const other = `${DIST_STAGING_PREFIX}firefox-dead2`
    writeTree(path.join(root, 'dist', mine), {'manifest.json': '{}'})
    writeTree(path.join(root, 'dist', other), {'manifest.json': '{}'})
    writeTree(path.join(root, 'dist', 'firefox'), {'manifest.json': '{}'})

    removeStaleStagingDirs(distPath)

    const names = listNames(path.join(root, 'dist'))
    expect(names).toContain('chrome')
    expect(names).toContain('firefox')
    expect(names).toContain(other)
    expect(names).not.toContain(mine)
  })

  it('removeStagingDir tolerates a path that does not exist', () => {
    expect(() =>
      removeStagingDir(path.join(root, 'dist', 'never-created'))
    ).not.toThrow()
  })
})
