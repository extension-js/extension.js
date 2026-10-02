import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'
import {
  isUsableBinaryPath,
  resolveFromBinaries
} from '../browsers-lib/output-binaries-resolver'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-stub-'))
  roots.push(root)

  return root
}

// A real managed binary on this machine is -rwxr-xr-x and tens of kilobytes.
// An interrupted download leaves the same path as a 0-byte, mode 644 file.
function writeBinary(target: string, bytes: number, mode: number): string {
  fs.mkdirSync(path.dirname(target), {recursive: true})
  fs.writeFileSync(target, Buffer.alloc(bytes))
  fs.chmodSync(target, mode)

  return target
}

describe('a stub left by an interrupted download is not a browser', () => {
  it('rejects an empty file', () => {
    const file = writeBinary(path.join(tempRoot(), 'chrome'), 0, 0o755)

    expect(isUsableBinaryPath(file)).toBe(false)
  })

  it.skipIf(process.platform === 'win32')(
    'rejects a non-empty file with no executable bit',
    () => {
      const file = writeBinary(path.join(tempRoot(), 'chrome'), 2048, 0o644)

      expect(isUsableBinaryPath(file)).toBe(false)
    }
  )

  it('accepts a non-empty executable file', () => {
    const file = writeBinary(path.join(tempRoot(), 'chrome'), 2048, 0o755)

    expect(isUsableBinaryPath(file)).toBe(true)
  })

  it('rejects a directory and a path that is not there', () => {
    const root = tempRoot()

    expect(isUsableBinaryPath(root)).toBe(false)
    expect(isUsableBinaryPath(path.join(root, 'nope'))).toBe(false)
    expect(isUsableBinaryPath('')).toBe(false)
  })

  // The point of the entry: a stub sorts first by build id, so without this
  // it shadowed a working install instead of being skipped.
  it.skipIf(process.platform === 'win32')(
    'skips a newer stub and resolves the working older install',
    () => {
      const base = tempRoot()
      const chromiumRoot = path.join(base, 'chromium', 'chromium')

      writeBinary(
        path.join(
          chromiumRoot,
          'mac_arm-999.0.0.0',
          'chrome-mac-arm64',
          'Chromium.app',
          'Contents',
          'MacOS',
          'Chromium'
        ),
        0,
        0o644
      )

      const working = writeBinary(
        path.join(
          chromiumRoot,
          'mac_arm-120.0.0.0',
          'chrome-mac-arm64',
          'Chromium.app',
          'Contents',
          'MacOS',
          'Chromium'
        ),
        4096,
        0o755
      )

      const compilation = {
        options: {output: {path: path.join(base, 'dist', 'chromium')}}
      } as unknown as Parameters<typeof resolveFromBinaries>[0]

      const previous = process.env.EXT_BROWSERS_CACHE_DIR
      process.env.EXT_BROWSERS_CACHE_DIR = base

      try {
        expect(resolveFromBinaries(compilation, 'chromium')).toBe(working)
      } finally {
        if (previous === undefined) delete process.env.EXT_BROWSERS_CACHE_DIR
        else process.env.EXT_BROWSERS_CACHE_DIR = previous
      }
    }
  )
})
