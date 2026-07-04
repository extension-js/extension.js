// Unit spec for control-port persistence — the reachability half of the
// stale-SW self-heal (see BridgeBroker stale-producer resync). The port file
// lives under dist/extension-js/<browser>/ so it shares dist/'s lifetime with
// the browser profile: wiped together, stale together.

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {afterEach, describe, expect, it} from 'vitest'
import {
  controlPortFilePath,
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
  it('resolves the file under dist/extension-js/<browser>/', () => {
    expect(controlPortFilePath('/proj', 'chromium')).toBe(
      path.join('/proj', 'dist', 'extension-js', 'chromium', 'control-port')
    )
  })

  it('round-trips a port (creating parent dirs)', () => {
    const file = controlPortFilePath(makeTmpDir(), 'chromium')
    writePersistedControlPort(file, 61234)
    expect(readPersistedControlPort(file)).toBe(61234)
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
