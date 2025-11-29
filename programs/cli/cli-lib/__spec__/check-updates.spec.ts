import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import checkUpdates from '../../check-updates'

vi.mock('update-check', () => ({
  default: vi.fn()
}))

const updateCheck = (await import('update-check'))
  .default as unknown as any

describe('check-updates', () => {
  const pkg = {name: 'extension', version: '2.0.0'}
  const originalEnv = process.env.EXTENSION_AUTHOR_MODE
  let logSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.clearAllMocks()
    process.env.EXTENSION_AUTHOR_MODE = originalEnv
  })

  it('prints update message for stable latest versions', async () => {
    updateCheck.mockResolvedValueOnce({latest: '2.1.0'})
    await checkUpdates(pkg)
    expect(logSpy).toHaveBeenCalled()
    expect(logSpy.mock.calls.join('\n')).toMatch(/update available/i)
    expect(logSpy.mock.calls.join('\n')).toMatch(/2.1.0/)
  })

  it('does not print for pre-release versions', async () => {
    updateCheck.mockResolvedValueOnce({latest: '2.1.0-beta.1'})
    await checkUpdates(pkg)
    expect(logSpy).not.toHaveBeenCalled()
  })

  it('logs error in development when update check fails', async () => {
    process.env.EXTENSION_AUTHOR_MODE = 'true'
    updateCheck.mockRejectedValueOnce(new Error('network error'))
    await checkUpdates(pkg)
    expect(errorSpy).toHaveBeenCalled()
    expect(errorSpy.mock.calls.join('\n')).toMatch(
      /Failed to check for updates/i
    )
  })
})
