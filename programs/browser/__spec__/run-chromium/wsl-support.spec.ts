import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest'
import {EventEmitter} from 'events'

vi.mock('child_process', () => ({spawn: vi.fn()}))
vi.mock('fs', () => ({existsSync: vi.fn()}))

const prevEnv = {...process.env}
const prevPlatform = process.platform

const setPlatform = (value: NodeJS.Platform) => {
  Object.defineProperty(process, 'platform', {
    value,
    configurable: true
  })
}

const loadModule = async () =>
  await import('../../run-chromium/chromium-launch/wsl-support')

const getSpawnMock = async () => {
  const mod = await import('child_process')
  return mod.spawn as unknown as ReturnType<typeof vi.fn>
}

const createChild = () => {
  const child = new EventEmitter() as any
  child.stdout = null
  child.stderr = null
  return child
}

describe('chromium wsl-support', () => {
  beforeEach(() => {
    process.env = {...prevEnv}
    setPlatform('linux')
    vi.restoreAllMocks()
  })

  afterEach(() => {
    process.env = {...prevEnv}
    setPlatform(prevPlatform)
  })

  it('detects WSL environment', async () => {
    const mod = await loadModule()
    delete process.env.WSL_DISTRO_NAME
    delete process.env.WSL_INTEROP
    delete process.env.WSLENV
    expect(mod.isWslEnv()).toBe(false)
    process.env.WSL_DISTRO_NAME = 'Ubuntu'
    expect(mod.isWslEnv()).toBe(true)
  })

  it('does not treat native Windows as WSL when only WSLENV exists', async () => {
    const mod = await loadModule()
    setPlatform('win32')
    process.env.WSLENV = 'FOO/p'
    delete process.env.WSL_DISTRO_NAME
    delete process.env.WSL_INTEROP
    expect(mod.isWslEnv()).toBe(false)
  })

  it('normalizes Windows paths when running on WSL', async () => {
    const mod = await loadModule()
    process.env.WSL_DISTRO_NAME = 'Ubuntu'
    const input = '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"'
    expect(mod.normalizeBinaryPathForWsl(input)).toBe(
      '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe'
    )
  })

  it('resolves Windows Chrome path on WSL', async () => {
    const mod = await loadModule()
    process.env.WSL_DISTRO_NAME = 'Ubuntu'
    const fs = await import('fs')
    const existsSync = fs.existsSync as unknown as ReturnType<typeof vi.fn>
    existsSync.mockImplementation(
      (p) => p === '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe'
    )
    expect(mod.resolveWslWindowsBinary('chrome')).toBe(
      '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe'
    )
    expect(existsSync).toHaveBeenCalled()
  })

  it('retries spawn with Windows binary on WSL failure', async () => {
    const mod = await loadModule()
    process.env.WSL_DISTRO_NAME = 'Ubuntu'
    const fs = await import('fs')
    const existsSync = fs.existsSync as unknown as ReturnType<typeof vi.fn>
    existsSync.mockImplementation(
      (p) => p === '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe'
    )
    const spawnMock = await getSpawnMock()
    const child1 = createChild()
    const child2 = createChild()
    spawnMock.mockReturnValueOnce(child1).mockReturnValueOnce(child2)
    const logger = {warn: vi.fn()}

    const promise = mod.spawnChromiumProcess({
      binary: '/usr/bin/google-chrome',
      launchArgs: [],
      stdio: 'ignore',
      browser: 'chrome',
      logger
    })

    setImmediate(() => child1.emit('error', new Error('spawn failed')))
    setImmediate(() => child2.emit('spawn'))

    const result = await promise
    expect(result).toBe(child2)
    expect(spawnMock).toHaveBeenCalledTimes(2)
    expect(spawnMock.mock.calls[1][0]).toBe(
      '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe'
    )
    expect(logger.warn).toHaveBeenCalled()
  })

  it('spawns without shell mode on native Windows', async () => {
    const mod = await loadModule()
    setPlatform('win32')
    const spawnMock = await getSpawnMock()
    const child = createChild()
    spawnMock.mockReturnValueOnce(child)

    const promise = mod.spawnChromiumProcess({
      binary: 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      launchArgs: ['--remote-debugging-port=9222'],
      stdio: 'ignore',
      browser: 'edge'
    })

    setImmediate(() => child.emit('spawn'))
    await promise

    const spawnOptions = spawnMock.mock.calls[0]?.[2]
    expect(spawnOptions).toMatchObject({
      detached: false
    })
    expect(spawnOptions).not.toHaveProperty('shell')
  })

  it('spawns without shell mode on non-Windows', async () => {
    const mod = await loadModule()
    setPlatform('linux')
    const spawnMock = await getSpawnMock()
    const child = createChild()
    spawnMock.mockReturnValueOnce(child)

    const promise = mod.spawnChromiumProcess({
      binary: '/usr/bin/google-chrome',
      launchArgs: ['--remote-debugging-port=9222'],
      stdio: 'ignore',
      browser: 'chrome'
    })

    setImmediate(() => child.emit('spawn'))
    await promise

    const spawnOptions = spawnMock.mock.calls[0]?.[2]
    expect(spawnOptions).toMatchObject({
      detached: false
    })
    expect(spawnOptions).not.toHaveProperty('shell')
  })
})
