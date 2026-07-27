import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {stampReadyProfileLocked} from '../browsers-lib/ready-stamp'
import {
  isProfileLockedError,
  prepareChromiumProfileForLaunch
} from '../browsers-lib/shared-utils'

describe('profile lock detection', () => {
  let profile: string

  beforeEach(() => {
    profile = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-profile-lock-'))
  })

  afterEach(() => {
    fs.rmSync(profile, {recursive: true, force: true})
  })

  it('tags the refusal with a code and the owning process', () => {
    fs.writeFileSync(
      path.join(profile, 'SingletonLock'),
      `${os.hostname()}-${process.pid}`,
      'utf8'
    )

    let caught: unknown
    try {
      prepareChromiumProfileForLaunch(profile)
    } catch (error) {
      caught = error
    }

    expect(isProfileLockedError(caught)).toBe(true)
    if (!isProfileLockedError(caught)) return
    expect(caught.code).toBe('profile_locked')
    expect(caught.profileLockOwner.pid).toBe(process.pid)
    expect(caught.profileLockOwner.host.toLowerCase()).toBe(
      os.hostname().toLowerCase()
    )
  })

  it('clears the lock of a dead owner instead of refusing', () => {
    fs.writeFileSync(
      path.join(profile, 'SingletonLock'),
      `${os.hostname()}-2147483600`,
      'utf8'
    )
    fs.writeFileSync(path.join(profile, 'SingletonSocket'), '', 'utf8')

    const result = prepareChromiumProfileForLaunch(profile)

    expect(result.removedArtifacts).toContain('SingletonLock')
    expect(fs.existsSync(path.join(profile, 'SingletonLock'))).toBe(false)
  })

  it('does not classify an unrelated launch failure as a lock', () => {
    expect(isProfileLockedError(new Error('boom'))).toBe(false)
    expect(isProfileLockedError(undefined)).toBe(false)
  })
})

describe('stampReadyProfileLocked', () => {
  let tmp: string
  let outputPath: string
  let readyPath: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-ready-lock-'))
    outputPath = path.join(tmp, 'dist', 'chromium')
    readyPath = path.join(tmp, 'dist', 'extension-js', 'chromium', 'ready.json')
    fs.mkdirSync(path.dirname(readyPath), {recursive: true})
  })

  afterEach(() => {
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  it('flips the contract to a profile_locked error', () => {
    fs.writeFileSync(
      readyPath,
      JSON.stringify({
        status: 'starting',
        browser: 'chromium',
        command: 'preview',
        runId: 'run-A'
      })
    )

    stampReadyProfileLocked(outputPath, {
      message: 'Chromium profile "/p" is already in use by process 42',
      owner: {host: 'host-a', pid: 42}
    })

    const ready = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
    expect(ready.status).toBe('error')
    expect(ready.code).toBe('profile_locked')
    expect(ready.message).toContain('already in use by process 42')
    expect(ready.profileLockOwner).toEqual({host: 'host-a', pid: 42})
    expect(typeof ready.profileLockedAt).toBe('string')
    expect(ready.runId).toBe('run-A')
  })

  it('falls back to a generic sentence when no message is given', () => {
    fs.writeFileSync(readyPath, JSON.stringify({status: 'starting'}))

    stampReadyProfileLocked(outputPath, {})

    const ready = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
    expect(ready.code).toBe('profile_locked')
    expect(ready.message).toMatch(/already in use/i)
    expect('profileLockOwner' in ready).toBe(false)
  })

  it('is a no-op when the contract file does not exist yet', () => {
    expect(() => stampReadyProfileLocked(outputPath, {})).not.toThrow()
    expect(() => stampReadyProfileLocked(undefined, {})).not.toThrow()
    expect(fs.existsSync(readyPath)).toBe(false)
  })
})
