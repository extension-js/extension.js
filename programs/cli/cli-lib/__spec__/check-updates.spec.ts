import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import checkUpdates from '../../check-updates'

vi.mock('../../cli-package-json', () => ({
  getCliPackageJson: () => ({name: 'extension', version: '2.0.0'})
}))

vi.mock('update-check', () => ({
  default: vi.fn()
}))

const updateCheck = (await import('update-check')).default as unknown as any

describe('check-updates', () => {
  const originalEnv = process.env.EXTENSION_AUTHOR_MODE
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.clearAllMocks()
    process.env.EXTENSION_AUTHOR_MODE = originalEnv
  })

  it('prints update message for stable latest versions', async () => {
    updateCheck.mockResolvedValueOnce({latest: '2.1.0'})
    const message = await checkUpdates()
    expect(message).toMatch(/update available/i)
    expect(message).toMatch(/2.1.0/)
  })

  it('does not print for pre-release versions', async () => {
    updateCheck.mockResolvedValueOnce({latest: '2.1.0-beta.1'})
    const message = await checkUpdates()
    expect(message).toBeNull()
  })

  it('logs error in development when update check fails', async () => {
    process.env.EXTENSION_AUTHOR_MODE = 'true'
    updateCheck.mockRejectedValueOnce(new Error('network error'))
    await checkUpdates()
    expect(errorSpy).toHaveBeenCalled()
    expect(errorSpy.mock.calls.join('\n')).toMatch(
      /Failed to check for updates/i
    )
  })
})
