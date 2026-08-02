import fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'

import {
  installManifestDiskWriteGuard,
  suppressManifestOutputWrites
} from '../index'

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-guard-'))
}

describe('installManifestDiskWriteGuard', () => {
  const uninstalls: Array<() => void> = []
  const tmpDirs: string[] = []

  afterEach(() => {
    while (uninstalls.length) uninstalls.pop()?.()
    while (tmpDirs.length) {
      const dir = tmpDirs.pop()
      if (dir) fs.rmSync(dir, {recursive: true, force: true})
    }
  })

  it('swallows writes to the guarded manifest and restores fs on uninstall', () => {
    const dir = makeTmpDir()
    tmpDirs.push(dir)
    const manifestPath = path.join(dir, 'manifest.json')

    const uninstall = installManifestDiskWriteGuard(manifestPath)
    uninstalls.push(uninstall)

    fs.writeFileSync(manifestPath, '{"guarded": true}')
    expect(fs.existsSync(manifestPath)).toBe(false)

    uninstall()
    fs.writeFileSync(manifestPath, '{"guarded": false}')
    expect(fs.readFileSync(manifestPath, 'utf8')).toBe('{"guarded": false}')
  })

  it('lets read opens through while redirecting write opens', () => {
    const dir = makeTmpDir()
    tmpDirs.push(dir)
    const manifestPath = path.join(dir, 'manifest.json')
    fs.writeFileSync(manifestPath, '{"name": "real"}')

    const uninstall = installManifestDiskWriteGuard(manifestPath)
    uninstalls.push(uninstall)

    // A dist-manifest reader must see real content, not /dev/null.
    const readFd = fs.openSync(manifestPath, 'r')
    const buffer = Buffer.alloc(16)
    const bytes = fs.readSync(readFd, buffer, 0, 16, 0)
    fs.closeSync(readFd)
    expect(buffer.toString('utf8', 0, bytes)).toContain('real')

    const writeFd = fs.openSync(manifestPath, 'w')
    fs.writeSync(writeFd, 'clobbered')
    fs.closeSync(writeFd)
    expect(fs.readFileSync(manifestPath, 'utf8')).toBe('{"name": "real"}')
  })

  it('keeps a shared path guarded until its last owner uninstalls', () => {
    const dir = makeTmpDir()
    tmpDirs.push(dir)
    const manifestPath = path.join(dir, 'manifest.json')

    const first = installManifestDiskWriteGuard(manifestPath)
    const second = installManifestDiskWriteGuard(manifestPath)
    uninstalls.push(first, second)

    first()
    fs.writeFileSync(manifestPath, 'still guarded')
    expect(fs.existsSync(manifestPath)).toBe(false)

    second()
    fs.writeFileSync(manifestPath, 'released')
    expect(fs.readFileSync(manifestPath, 'utf8')).toBe('released')
  })
})

describe('suppressManifestOutputWrites', () => {
  it('adds a second server path to the shared output fs instead of no-opping', () => {
    const written: string[] = []
    // rspack hands every compiler the same node_fs singleton, so both
    // servers patch one object; the second must not inherit only the first
    // server's suppression.
    const sharedOutputFs = {
      writeFile: (filePath: string, ...args: unknown[]) => {
        written.push(filePath)
        const callback = args[args.length - 1]
        if (typeof callback === 'function') callback(null)
      }
    }
    const serverOnePath = '/proj-one/dist/chrome/manifest.json'
    const serverTwoPath = '/proj-two/dist/chrome/manifest.json'

    const releaseOne = suppressManifestOutputWrites(
      {outputFileSystem: sharedOutputFs},
      serverOnePath
    )
    const releaseTwo = suppressManifestOutputWrites(
      {outputFileSystem: sharedOutputFs},
      serverTwoPath
    )

    sharedOutputFs.writeFile(serverOnePath, 'data', () => {})
    sharedOutputFs.writeFile(serverTwoPath, 'data', () => {})
    sharedOutputFs.writeFile(
      '/proj-two/dist/chrome/popup.html',
      'data',
      () => {}
    )
    expect(written).toEqual(['/proj-two/dist/chrome/popup.html'])

    releaseTwo()
    sharedOutputFs.writeFile(serverTwoPath, 'data', () => {})
    expect(written).toContain(serverTwoPath)

    releaseOne()
  })
})
