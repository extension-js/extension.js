import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import checkUpdatesWith from '../check-updates'

const updateCheck = vi.fn()

// The real lookup asks the npm registry about the installed CLI.
const checkUpdates = () =>
  checkUpdatesWith({
    check: updateCheck,
    readPackageJson: () => ({name: 'extension', version: '2.0.0'})
  })

describe('check-updates', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  it('prints update message for stable latest versions', async () => {
    updateCheck.mockResolvedValueOnce({latest: '2.1.0'})
    const result = await checkUpdates()
    expect(result).not.toBeNull()
    expect(result?.message).toMatch(/update is available/i)
    expect(result?.message).toMatch(/2.1.0/)
    expect(result?.suffix).toMatch(/2.1.0/)
  })

  it('does not print for pre-release versions', async () => {
    updateCheck.mockResolvedValueOnce({latest: '2.1.0-beta.1'})
    const message = await checkUpdates()
    expect(message).toBeNull()
  })

  it('logs error in development when update check fails', async () => {
    vi.stubEnv('EXTENSION_AUTHOR_MODE', 'true')
    updateCheck.mockRejectedValueOnce(new Error('network error'))
    await checkUpdates()
    expect(errorSpy).toHaveBeenCalled()
    expect(errorSpy.mock.calls.join('\n')).toMatch(
      /Couldn't check for updates/i
    )
  })
})
