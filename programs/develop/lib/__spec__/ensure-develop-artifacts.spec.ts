import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
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
    expect(fallbackArgs).toEqual([
      'install',
      '--no-package-lock',
      '--ignore-scripts'
    ])
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

    const [, args] = execInstallCommand.mock.calls[0]
    expect(args).toEqual(['install', '--ignore-scripts', '--ignore-workspace'])
  })

  it('installs a pnpm workspace member from the workspace root, filtered, never in the member dir', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-eda-ws-'))

    try {
      fs.writeFileSync(
        path.join(root, 'pnpm-workspace.yaml'),
        'packages: ["apps/*"]\n'
      )

      const member = path.join(root, 'apps', 'ext')
      fs.mkdirSync(member, {recursive: true})
      fs.writeFileSync(
        path.join(member, 'package.json'),
        JSON.stringify({name: 'ext', dependencies: {vue: '^3.0.0'}})
      )

      resolvePackageManager.mockReturnValue({name: 'pnpm'})
      execInstallCommand.mockResolvedValueOnce(undefined)

      await ensureUserProjectDependencies(member as any)

      expect(resolvePackageManager).toHaveBeenCalledWith({cwd: root})
      const [, args, options] = execInstallCommand.mock.calls[0]
      expect(args).toEqual([
        'install',
        '--ignore-scripts',
        '--filter',
        '{apps/ext}...'
      ])

      expect(options.cwd).toBe(root)
      const warned = (console.warn as any).mock.calls
        .map((call: any[]) => String(call[0]))
        .join('\n')
      expect(warned).toContain(root)
      expect(warned).toContain('workspace root')
    } finally {
      fs.rmSync(root, {recursive: true, force: true})
    }
  })

  it('suppresses lifecycle scripts by default: auto-install must not run wild postinstall', async () => {
    resolvePackageManager.mockReturnValue({name: 'npm'})
    execInstallCommand.mockResolvedValueOnce(undefined)

    await ensureUserProjectDependencies('/nonexistent-project' as any)

    const [, args] = execInstallCommand.mock.calls[0]
    expect(args).toContain('--ignore-scripts')
  })

  it('suppresses yarn scripts via env (Berry rejects --ignore-scripts, yarn 1 reads npm_config_*)', async () => {
    resolvePackageManager.mockReturnValue({name: 'yarn'})
    execInstallCommand.mockResolvedValueOnce(undefined)

    await ensureUserProjectDependencies('/nonexistent-project' as any)

    const [, args, options] = execInstallCommand.mock.calls[0]
    expect(args).not.toContain('--ignore-scripts')
    expect(options.env).toMatchObject({
      YARN_ENABLE_SCRIPTS: 'false',
      npm_config_ignore_scripts: 'true'
    })
  })

  it('runs lifecycle scripts when EXTENSION_ALLOW_INSTALL_SCRIPTS=true', async () => {
    process.env.EXTENSION_ALLOW_INSTALL_SCRIPTS = 'true'

    try {
      resolvePackageManager.mockReturnValue({name: 'npm'})
      execInstallCommand.mockResolvedValueOnce(undefined)

      await ensureUserProjectDependencies('/nonexistent-project' as any)

      const [, args, options] = execInstallCommand.mock.calls[0]
      expect(args).not.toContain('--ignore-scripts')
      expect(options.env).toEqual({})
    } finally {
      delete process.env.EXTENSION_ALLOW_INSTALL_SCRIPTS
    }
  })
})
