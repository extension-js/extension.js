import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest'
import {EventEmitter} from 'events'

vi.mock('child_process', () => ({spawn: vi.fn()}))
vi.mock('fs', () => ({existsSync: vi.fn()}))

const prevEnv = {...process.env}

const loadModule = async () =>
  await import('../../run-firefox/firefox-launch/wsl-support')

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

describe('firefox wsl-support', () => {
  beforeEach(() => {
    process.env = {...prevEnv}
    vi.restoreAllMocks()
  })

  afterEach(() => {
    process.env = {...prevEnv}
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

  it('normalizes Windows paths when running on WSL', async () => {
    const mod = await loadModule()
    process.env.WSL_DISTRO_NAME = 'Ubuntu'
    const input = '"C:\\Program Files\\Mozilla Firefox\\firefox.exe"'
    expect(mod.normalizeBinaryPathForWsl(input)).toBe(
      '/mnt/c/Program Files/Mozilla Firefox/firefox.exe'
    )
  })

  it('resolves Windows Firefox path on WSL', async () => {
    const mod = await loadModule()
    process.env.WSL_DISTRO_NAME = 'Ubuntu'
    const fs = await import('fs')
    const existsSync = fs.existsSync as unknown as ReturnType<typeof vi.fn>
    existsSync.mockImplementation(
      (p) => p === '/mnt/c/Program Files/Mozilla Firefox/firefox.exe'
    )
    expect(mod.resolveWslWindowsBinary()).toBe(
      '/mnt/c/Program Files/Mozilla Firefox/firefox.exe'
    )
    expect(existsSync).toHaveBeenCalled()
  })

  it('retries spawn with Windows binary on WSL failure', async () => {
    const mod = await loadModule()
    process.env.WSL_DISTRO_NAME = 'Ubuntu'
    const spawnMock = await getSpawnMock()
    const child1 = createChild()
    const child2 = createChild()
    spawnMock.mockReturnValueOnce(child1).mockReturnValueOnce(child2)
    const logger = {warn: vi.fn()}
    const fallbackBinary = '/mnt/c/Program Files/Mozilla Firefox/firefox.exe'

    const promise = mod.spawnFirefoxProcess({
      binary: '/usr/bin/firefox',
      args: [],
      stdio: 'ignore',
      fallbackBinary,
      logger
    })

    setImmediate(() => child1.emit('error', new Error('spawn failed')))
    setImmediate(() => child2.emit('spawn'))

    const result = await promise
    expect(result).toBe(child2)
    expect(spawnMock).toHaveBeenCalledTimes(2)
    expect(spawnMock.mock.calls[1][0]).toBe(fallbackBinary)
    expect(logger.warn).toHaveBeenCalled()
  })
})
