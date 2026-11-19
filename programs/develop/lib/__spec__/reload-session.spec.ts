import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {isReloadSession} from '../reload-session'

beforeEach(() => {
  vi.stubEnv('EXTENSION_NO_RELOAD', undefined)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('isReloadSession', () => {
  it('is a session in development unless the build says it is not', () => {
    expect(isReloadSession('development', undefined)).toBe(true)
    expect(isReloadSession('development', true)).toBe(true)
    expect(isReloadSession(undefined, true)).toBe(true)
    expect(isReloadSession('development', false)).toBe(false)
  })

  it('is never a session in production', () => {
    expect(isReloadSession('production', undefined)).toBe(false)
    expect(isReloadSession('production', true)).toBe(false)
  })

  it('is not a session with reload turned off', () => {
    vi.stubEnv('EXTENSION_NO_RELOAD', 'true')

    expect(isReloadSession('development', true)).toBe(false)
  })

  it('reads only the exact value true as reload turned off', () => {
    vi.stubEnv('EXTENSION_NO_RELOAD', 'false')

    expect(isReloadSession('development', true)).toBe(true)
  })
})
