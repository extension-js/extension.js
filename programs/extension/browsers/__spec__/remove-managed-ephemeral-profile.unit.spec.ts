import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {
  markManagedEphemeralProfile,
  removeManagedEphemeralProfile
} from '../browsers-lib/shared-utils'

describe('removeManagedEphemeralProfile', () => {
  const created: string[] = []

  const makeDir = (name: string) => {
    const dir = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-profile-')),
      name
    )
    fs.mkdirSync(dir, {recursive: true})
    created.push(dir)
    return dir
  }

  afterEach(() => {
    for (const dir of created.splice(0)) {
      try {
        fs.rmSync(path.dirname(dir), {recursive: true, force: true})
      } catch {
        // Ignore
      }
    }
  })

  it('removes a directory that carries the managed-ephemeral marker', () => {
    const dir = makeDir('happy-blue-cat')
    markManagedEphemeralProfile(dir)
    expect(fs.existsSync(dir)).toBe(true)

    removeManagedEphemeralProfile(dir)
    expect(fs.existsSync(dir)).toBe(false)
  })

  it('keeps a directory WITHOUT the marker (e.g. a user-provided profile)', () => {
    const dir = makeDir('my-profile')
    removeManagedEphemeralProfile(dir)
    expect(fs.existsSync(dir)).toBe(true)
  })

  it('never removes the stable persistent profile named "dev", even if marked', () => {
    const dir = makeDir('dev')
    markManagedEphemeralProfile(dir)
    removeManagedEphemeralProfile(dir)
    expect(fs.existsSync(dir)).toBe(true)
  })

  it('is a no-op for undefined / nonexistent paths', () => {
    expect(() => removeManagedEphemeralProfile(undefined)).not.toThrow()
    expect(() =>
      removeManagedEphemeralProfile('/no/such/extjs/profile/dir')
    ).not.toThrow()
  })
})
