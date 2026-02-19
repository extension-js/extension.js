import {describe, it, expect, beforeEach, afterEach} from 'vitest'
import {browserNotInstalledError} from '../browsers-lib/messages'

describe('browserNotInstalledError (WSL)', () => {
  const prev = {...process.env}
  const prevPlatform = process.platform

  const setPlatform = (value: NodeJS.Platform) => {
    Object.defineProperty(process, 'platform', {
      value,
      configurable: true
    })
  }

  beforeEach(() => {
    process.env = {...prev}
    setPlatform('linux')
  })

  afterEach(() => {
    process.env = {...prev}
    setPlatform(prevPlatform)
  })

  it('includes a WSL hint when running under WSL env', () => {
    process.env.WSL_DISTRO_NAME = 'Ubuntu'
    const msg = browserNotInstalledError('chrome' as any, '')
    expect(msg).toMatch(/WSL detected/)
    expect(msg).toMatch(/--chromium-binary/)
    expect(msg).toMatch(/\/mnt\/c\//)
  })

  it('does not include a WSL hint when not running under WSL env', () => {
    delete process.env.WSL_DISTRO_NAME
    delete process.env.WSL_INTEROP
    delete process.env.WSLENV
    const msg = browserNotInstalledError('chrome' as any, '')
    expect(msg).not.toMatch(/WSL detected/)
  })

  it('does not include WSL hint on native Windows with only WSLENV set', () => {
    setPlatform('win32')
    process.env.WSLENV = 'FOO/p'
    delete process.env.WSL_DISTRO_NAME
    delete process.env.WSL_INTEROP
    const msg = browserNotInstalledError('chrome' as any, '')
    expect(msg).not.toMatch(/WSL detected/)
  })
})
