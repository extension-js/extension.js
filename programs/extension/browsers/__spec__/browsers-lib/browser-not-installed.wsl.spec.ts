import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {browserNotInstalledError} from '../../browsers-lib/messages'

describe('browserNotInstalledError (WSL)', () => {
  const prevPlatform = process.platform

  const setPlatform = (value: NodeJS.Platform) => {
    Object.defineProperty(process, 'platform', {
      value,
      configurable: true
    })
  }

  beforeEach(() => {
    setPlatform('linux')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    setPlatform(prevPlatform)
  })

  it('includes a WSL hint when running under WSL env', () => {
    vi.stubEnv('WSL_DISTRO_NAME', 'Ubuntu')
    const msg = browserNotInstalledError('chrome' as any, '')
    expect(msg).toMatch(/WSL detected/)
    expect(msg).toMatch(/--chromium-binary/)
    expect(msg).toMatch(/\/mnt\/c\//)
  })

  it('does not include a WSL hint when not running under WSL env', () => {
    vi.stubEnv('WSL_DISTRO_NAME', undefined)
    vi.stubEnv('WSL_INTEROP', undefined)
    vi.stubEnv('WSLENV', undefined)
    const msg = browserNotInstalledError('chrome' as any, '')
    expect(msg).not.toMatch(/WSL detected/)
  })

  it('does not include WSL hint on native Windows with only WSLENV set', () => {
    setPlatform('win32')
    vi.stubEnv('WSLENV', 'FOO/p')
    vi.stubEnv('WSL_DISTRO_NAME', undefined)
    vi.stubEnv('WSL_INTEROP', undefined)
    const msg = browserNotInstalledError('chrome' as any, '')
    expect(msg).not.toMatch(/WSL detected/)
  })
})
