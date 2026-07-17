// Unit spec for control-port persistence — the reachability half of the
// stale-SW self-heal (see BridgeBroker stale-producer resync). The port file
// lives under the project's .extension-js/ dir so it outlives dist/: a kept
// or explicit browser profile survives a dist wipe, and its cached SW can
// only resync if the next session rebinds the port it has baked in (#484).

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {afterEach, describe, expect, it} from 'vitest'
import {
  controlPortFilePath,
  legacyControlPortFilePath,
  readPersistedControlPort,
  writePersistedControlPort
} from '../control-port-store'

let tmpDir: string | undefined

afterEach(() => {
  if (tmpDir) fs.rmSync(tmpDir, {recursive: true, force: true})
  tmpDir = undefined
})

function makeTmpDir(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-control-port-'))
  return tmpDir
}

describe('control-port-store', () => {
  it('resolves the file under .extension-js/, outside dist/', () => {
    expect(controlPortFilePath('/proj', 'chromium')).toBe(
      path.resolve('/proj', '.extension-js', 'control-port-chromium')
    )
  })

  it('keeps the port file per browser', () => {
    expect(controlPortFilePath('/proj', 'chrome')).not.toBe(
      controlPortFilePath('/proj', 'chromium')
    )
  })

  it('resolves the legacy (pre-#484) file under dist/extension-js/<browser>/', () => {
    expect(legacyControlPortFilePath('/proj', 'chromium')).toBe(
      path.resolve('/proj', 'dist', 'extension-js', 'chromium', 'control-port')
    )
  })

  it('round-trips a port (creating parent dirs)', () => {
    const file = controlPortFilePath(makeTmpDir(), 'chromium')
    writePersistedControlPort(file, 61234)
    expect(readPersistedControlPort(file)).toBe(61234)
  })

  it('survives a dist/ wipe', () => {
    const proj = makeTmpDir()
    const file = controlPortFilePath(proj, 'chrome')
    writePersistedControlPort(file, 53763)
    fs.rmSync(path.join(proj, 'dist'), {recursive: true, force: true})
    expect(readPersistedControlPort(file)).toBe(53763)
  })

  it('returns null for a missing file', () => {
    const file = controlPortFilePath(makeTmpDir(), 'chromium')
    expect(readPersistedControlPort(file)).toBeNull()
  })

  it('returns null for garbage or out-of-range content', () => {
    const file = controlPortFilePath(makeTmpDir(), 'chromium')
    fs.mkdirSync(path.dirname(file), {recursive: true})
    for (const content of ['nope', '', '0', '-5', '70000']) {
      fs.writeFileSync(file, content)
      expect(readPersistedControlPort(file)).toBeNull()
    }
  })
})
