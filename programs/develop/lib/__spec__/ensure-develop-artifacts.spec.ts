import {beforeEach, describe, expect, it, vi} from 'vitest'

const execInstallCommand = vi.fn()
const resolvePackageManager = vi.fn()
const resolveNpmPackageManager = vi.fn()

vi.mock('../package-manager', async (importOriginal) => {
  const actual = (await importOriginal()) as any
  return {
    ...actual,
    execInstallCommand: (...args: any[]) => execInstallCommand(...args),
    resolvePackageManager: (...args: any[]) => resolvePackageManager(...args),
    resolveNpmPackageManager: (...args: any[]) =>
      resolveNpmPackageManager(...args)
  }
})

vi.mock('../paths', async (importOriginal) => {
  const actual = (await importOriginal()) as any
  return {...actual, needsInstall: vi.fn(() => true)}
})

import {ensureUserProjectDependencies} from '../ensure-develop-artifacts'

describe('ensureUserProjectDependencies', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    resolveNpmPackageManager.mockReturnValue({name: 'npm'})
  })

  it('falls back to npm once when the resolved manager fails (G28: corepack-pinned ancient pnpm)', async () => {
    resolvePackageManager.mockReturnValue({name: 'pnpm'})
    execInstallCommand
      .mockRejectedValueOnce(new Error('Install failed with exit code 1'))
      .mockResolvedValueOnce(undefined)

    await ensureUserProjectDependencies('/project' as any)

    expect(execInstallCommand).toHaveBeenCalledTimes(2)
    const [, fallbackArgs] = execInstallCommand.mock.calls[1]
    expect(fallbackArgs).toEqual(['install', '--no-package-lock'])
  })

  it('does not retry when npm itself was the resolved manager', async () => {
    resolvePackageManager.mockReturnValue({name: 'npm'})
    execInstallCommand.mockRejectedValueOnce(
      new Error('Install failed with exit code 1')
    )

    await expect(
      ensureUserProjectDependencies('/project' as any)
    ).rejects.toThrow('exit code 1')
    expect(execInstallCommand).toHaveBeenCalledTimes(1)
  })

  it('passes the confinement args from projectInstallArgs to the first install', async () => {
    resolvePackageManager.mockReturnValue({name: 'pnpm'})
    execInstallCommand.mockResolvedValueOnce(undefined)

    await ensureUserProjectDependencies('/nonexistent-project' as any)

    // package.json is unreadable at that path, so confinement still applies
    const [, args] = execInstallCommand.mock.calls[0]
    expect(args).toEqual(['install', '--ignore-workspace'])
  })
})
