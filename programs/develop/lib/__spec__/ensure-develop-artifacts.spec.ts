import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {stripVTControlCharacters} from 'node:util'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const execInstallCommand = vi.fn()
const resolvePackageManager = vi.fn()

vi.mock('../package-manager', async (importOriginal) => {
  const actual = (await importOriginal()) as any

  return {
    ...actual,
    execInstallCommand: (...args: any[]) => execInstallCommand(...args),
    resolvePackageManager: (...args: any[]) => resolvePackageManager(...args)
  }
})

vi.mock('../paths', async (importOriginal) => {
  const actual = (await importOriginal()) as any

  return {...actual, needsInstall: vi.fn(() => true)}
})

import {ensureUserProjectDependencies} from '../ensure-develop-artifacts'
import {CAPTURED_INSTALL_FAILURES} from './install-failure-captures'

function installFailure(output: string) {
  return Object.assign(new Error('Install failed with exit code 1'), {
    exitCode: 1,
    output
  })
}

function warnings(): string[] {
  return (console.warn as any).mock.calls.map((call: any[]) =>
    stripVTControlCharacters(String(call[0]))
  )
}

describe('ensureUserProjectDependencies', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it.each([
    'pnpm',
    'yarn',
    'bun',
    'deno',
    'npm'
  ])('installs with the project manager only and frames its failure once (%s)', async (manager) => {
    resolvePackageManager.mockReturnValue({name: manager})
    execInstallCommand.mockRejectedValue(installFailure('Segmentation fault'))

    const error: any = await ensureUserProjectDependencies(
      '/project' as any
    ).catch((caught) => caught)

    expect(execInstallCommand).toHaveBeenCalledTimes(1)
    expect(error.code).toBe('E_DEPENDENCY_INSTALL')
    expect(stripVTControlCharacters(error.message)).toBe(
      [
        `⏵⏵⏵ Error: Couldn't install the project dependencies with ${manager}.`,
        `${manager} exited with code 1. The ${manager} error is printed above.`,
        `Fix it, or run ${manager} install yourself, then run the command again.`
      ].join('\n')
    )
  })

  it.each([
    [
      'pnpm',
      'Install it with npm install -g pnpm, then run the command again.'
    ],
    [
      'yarn',
      'Install it with npm install -g yarn, then run the command again.'
    ],
    ['bun', 'Install bun, then run the command again.'],
    ['deno', 'Install deno, then run the command again.'],
    [
      'npm',
      'It ships with Node.js, so reinstall Node.js, then run the command again.'
    ]
  ])('says the manager is not on PATH and how to install it (%s)', async (manager, step) => {
    resolvePackageManager.mockReturnValue({name: manager})
    execInstallCommand.mockRejectedValue(
      Object.assign(new Error(`spawn ${manager} ENOENT`), {code: 'ENOENT'})
    )

    const error: any = await ensureUserProjectDependencies(
      '/project' as any
    ).catch((caught) => caught)

    expect(execInstallCommand).toHaveBeenCalledTimes(1)
    expect(error.code).toBe('E_DEPENDENCY_INSTALL')
    expect(stripVTControlCharacters(error.message)).toBe(
      [
        `⏵⏵⏵ Error: Couldn't install the project dependencies with ${manager}.`,
        `This project installs with ${manager}, but ${manager} is not on PATH.`,
        step
      ].join('\n')
    )
  })

  it('names what stopped a manager that could not start for another reason', async () => {
    resolvePackageManager.mockReturnValue({name: 'pnpm'})
    execInstallCommand.mockRejectedValue(
      Object.assign(new Error('spawn pnpm EACCES'), {code: 'EACCES'})
    )

    const error: any = await ensureUserProjectDependencies(
      '/project' as any
    ).catch((caught) => caught)

    expect(stripVTControlCharacters(error.message)).toBe(
      [
        "⏵⏵⏵ Error: Couldn't install the project dependencies with pnpm.",
        'pnpm could not start (spawn pnpm EACCES).',
        'Fix it, or run pnpm install yourself, then run the command again.'
      ].join('\n')
    )
  })

  it.each([
    [
      'pnpm',
      'corepack-pnpm-404',
      'Corepack could not download pnpm from http://registry.test (HTTP 404), so pnpm never started.'
    ],
    [
      'pnpm',
      'corepack-pnpm-latest-404',
      'Corepack could not download pnpm from http://registry.test (HTTP 404), so pnpm never started.'
    ],
    [
      'pnpm',
      'corepack-pnpm-refused',
      'Corepack could not download pnpm from http://registry.test, so pnpm never started.'
    ],
    [
      'yarn',
      'corepack-yarn-404',
      'Corepack could not download yarn from http://registry.test (HTTP 404), so yarn never started.'
    ]
  ])('says Corepack could not download %s and from where (%s)', async (manager, capture, cause) => {
    vi.stubEnv('npm_config_registry', '')
    vi.stubEnv('COREPACK_NPM_REGISTRY', '')
    resolvePackageManager.mockReturnValue({name: manager})
    execInstallCommand.mockRejectedValue(
      installFailure(CAPTURED_INSTALL_FAILURES[capture])
    )

    const error: any = await ensureUserProjectDependencies('/project' as any, {
      sleep: async () => {}
    }).catch((caught) => caught)

    expect(execInstallCommand).toHaveBeenCalledTimes(1)
    expect(error.code).toBe('E_DEPENDENCY_INSTALL')
    expect(stripVTControlCharacters(error.message)).toBe(
      [
        `⏵⏵⏵ Error: Couldn't install the project dependencies with ${manager}.`,
        cause,
        `Check that the registry serves ${manager} and can be reached, or set COREPACK_NPM_REGISTRY to one that does.`,
        'The Corepack error is printed above.'
      ].join('\n')
    )
  })

  describe('a registry Extension.js handed to Corepack', () => {
    let project: string

    beforeEach(() => {
      project = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-eda-corepack-'))
      vi.stubEnv('npm_config_registry', '')
      vi.stubEnv('COREPACK_NPM_REGISTRY', '')
      resolvePackageManager.mockReturnValue({name: 'pnpm'})
      execInstallCommand.mockRejectedValue(
        installFailure(CAPTURED_INSTALL_FAILURES['corepack-pnpm-404'])
      )
    })

    afterEach(() => {
      vi.unstubAllEnvs()
      fs.rmSync(project, {recursive: true, force: true})
    })

    async function framed(): Promise<string[]> {
      const error: any = await ensureUserProjectDependencies(
        project as any
      ).catch((caught) => caught)

      expect(error.code).toBe('E_DEPENDENCY_INSTALL')

      return stripVTControlCharacters(error.message).split('\n')
    }

    const head = [
      "⏵⏵⏵ Error: Couldn't install the project dependencies with pnpm.",
      'Corepack could not download pnpm from http://registry.test (HTTP 404), so pnpm never started.'
    ]
    const tail = [
      'Check that the registry serves pnpm and can be reached, or set COREPACK_NPM_REGISTRY to one that does.',
      'The Corepack error is printed above.'
    ]

    it('says the registry came from the project .npmrc', async () => {
      fs.writeFileSync(
        path.join(project, '.npmrc'),
        'registry=http://registry.test/\n'
      )

      expect(await framed()).toEqual([
        ...head,
        "Extension.js pointed Corepack at that registry because the project's .npmrc names it.",
        ...tail
      ])
    })

    it('says the registry came from npm_config_registry', async () => {
      vi.stubEnv('npm_config_registry', 'http://registry.test/')

      expect(await framed()).toEqual([
        ...head,
        'Extension.js pointed Corepack at that registry because npm_config_registry names it.',
        ...tail
      ])
    })

    it('claims nothing when the user set COREPACK_NPM_REGISTRY', async () => {
      fs.writeFileSync(
        path.join(project, '.npmrc'),
        'registry=http://registry.test/\n'
      )

      vi.stubEnv('COREPACK_NPM_REGISTRY', 'http://registry.test')

      expect(await framed()).toEqual([...head, ...tail])
    })

    it('claims nothing when the project .npmrc names another registry', async () => {
      fs.writeFileSync(
        path.join(project, '.npmrc'),
        'registry=http://other.test/\n'
      )

      expect(await framed()).toEqual([...head, ...tail])
    })
  })

  for (const value of ['1', 'true', ' TRUE ']) {
    it(`installs nothing and prints nothing when EXTENSION_SKIP_INSTALL is ${JSON.stringify(value)}`, async () => {
      resolvePackageManager.mockReturnValue({name: 'npm'})
      vi.stubEnv('EXTENSION_SKIP_INSTALL', value)

      try {
        await ensureUserProjectDependencies('/project' as any)
      } finally {
        vi.unstubAllEnvs()
      }

      expect(execInstallCommand).not.toHaveBeenCalled()
      expect(console.warn).not.toHaveBeenCalled()
    })
  }

  for (const value of ['', '0', 'false']) {
    it(`still installs when EXTENSION_SKIP_INSTALL is ${JSON.stringify(value)}`, async () => {
      resolvePackageManager.mockReturnValue({name: 'npm'})
      execInstallCommand.mockResolvedValueOnce(undefined)
      vi.stubEnv('EXTENSION_SKIP_INSTALL', value)

      try {
        await ensureUserProjectDependencies('/project' as any)
      } finally {
        vi.unstubAllEnvs()
      }

      expect(execInstallCommand).toHaveBeenCalledTimes(1)
    })
  }

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

  it.each([
    ['npm', 'package-lock.json'],
    ['yarn', 'yarn.lock']
  ])('installs a %s workspace member from the workspace root', async (manager, lockfile) => {
    const root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-eda-pkgws-'))
    )

    try {
      fs.mkdirSync(path.join(root, '.git'))
      fs.writeFileSync(
        path.join(root, 'package.json'),
        JSON.stringify({name: 'root', workspaces: ['apps/*']})
      )

      fs.writeFileSync(path.join(root, lockfile), '')

      const member = path.join(root, 'apps', 'ext')
      fs.mkdirSync(member, {recursive: true})
      fs.writeFileSync(
        path.join(member, 'package.json'),
        JSON.stringify({name: 'ext', dependencies: {vue: '^3.0.0'}})
      )

      resolvePackageManager.mockReturnValue({name: manager})
      execInstallCommand.mockResolvedValueOnce(undefined)

      await ensureUserProjectDependencies(member as any)

      expect(resolvePackageManager).toHaveBeenCalledWith({cwd: root})
      const [, args, options] = execInstallCommand.mock.calls[0]
      expect(args).not.toContain('--ignore-workspace')
      expect(options.cwd).toBe(root)
      const warned = (console.warn as any).mock.calls
        .map((call: any[]) => String(call[0]))
        .join('\n')
      expect(warned).toContain(`${manager} workspace member`)
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

  it('sends the install output to stderr under machine output and to its own streams otherwise', async () => {
    resolvePackageManager.mockReturnValue({name: 'pnpm'})
    execInstallCommand.mockResolvedValue(undefined)

    vi.stubEnv('EXTENSION_OUTPUT', 'json')

    try {
      await ensureUserProjectDependencies('/nonexistent-project' as any)
    } finally {
      vi.unstubAllEnvs()
    }

    const [, , machineOptions] = execInstallCommand.mock.calls[0]
    expect(machineOptions.tee.stdout).toBe(process.stderr)
    expect(machineOptions.tee.stderr).toBe(process.stderr)

    await ensureUserProjectDependencies('/nonexistent-project' as any)

    const [, , prettyOptions] = execInstallCommand.mock.calls[1]
    expect(prettyOptions.tee.stdout).toBe(process.stdout)
    expect(prettyOptions.tee.stderr).toBe(process.stderr)
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

  describe('a registry that is not ready', () => {
    const sleep = vi.fn(async () => {})

    beforeEach(() => sleep.mockClear())

    it.each([
      'npm',
      'pnpm',
      'yarn',
      'bun'
    ])('installs again after a listed tarball answers 404, then succeeds (%s)', async (manager) => {
      resolvePackageManager.mockReturnValue({name: manager})
      execInstallCommand
        .mockRejectedValueOnce(
          installFailure(CAPTURED_INSTALL_FAILURES[`${manager}-tarball-404`])
        )
        .mockRejectedValueOnce(
          installFailure(CAPTURED_INSTALL_FAILURES[`${manager}-tarball-404`])
        )
        .mockResolvedValueOnce(undefined)

      await ensureUserProjectDependencies('/nonexistent-project' as any, {
        sleep
      })

      expect(execInstallCommand).toHaveBeenCalledTimes(3)
      expect(sleep.mock.calls).toEqual([[5000], [10000]])
      // The same manager and the same command every time, never npm instead.
      expect(execInstallCommand.mock.calls[2].slice(0, 2)).toEqual(
        execInstallCommand.mock.calls[0].slice(0, 2)
      )

      expect(
        warnings().filter((line) => line.includes('Retrying the install'))
      ).toEqual([
        '⏵⏵⏵ Warning: The registry lists stubx-dep@1.0.1 but is not serving its tarball yet. Retrying the install in 5 seconds (attempt 2 of 4).',
        '⏵⏵⏵ Warning: The registry lists stubx-dep@1.0.1 but is not serving its tarball yet. Retrying the install in 10 seconds (attempt 3 of 4).'
      ])
    })

    it('stops after four attempts with one error that names the version and the next step', async () => {
      resolvePackageManager.mockReturnValue({name: 'pnpm'})
      execInstallCommand.mockRejectedValue(
        installFailure(CAPTURED_INSTALL_FAILURES['pnpm10-tarball-404'])
      )

      const error: any = await ensureUserProjectDependencies(
        '/nonexistent-project' as any,
        {sleep}
      ).catch((caught) => caught)

      expect(execInstallCommand).toHaveBeenCalledTimes(4)
      expect(sleep.mock.calls).toEqual([[5000], [10000], [20000]])
      expect(error.code).toBe('E_DEPENDENCY_INSTALL')
      expect(stripVTControlCharacters(error.message)).toBe(
        [
          "⏵⏵⏵ Error: Couldn't install the project dependencies with pnpm.",
          'The registry lists stubx-dep@1.0.1 but is not serving its tarball yet.',
          'A new release takes a minute or two to reach the whole registry. Extension.js tried 4 times over 35 seconds.',
          'Run the command again in a minute. The pnpm error is printed above.'
        ].join('\n')
      )
    })

    it('waits for a range an upstream package asked for, and names it when it never lands', async () => {
      resolvePackageManager.mockReturnValue({name: 'npm'})
      execInstallCommand.mockRejectedValue(
        installFailure(CAPTURED_INSTALL_FAILURES['npm-version-transitive'])
      )

      const error: any = await ensureUserProjectDependencies(
        '/nonexistent-project' as any,
        {sleep, delaysMs: [1000]}
      ).catch((caught) => caught)

      expect(execInstallCommand).toHaveBeenCalledTimes(2)
      expect(stripVTControlCharacters(error.message)).toBe(
        [
          "⏵⏵⏵ Error: Couldn't install the project dependencies with npm.",
          'A dependency asks for stubx-late@^4.0.3, which the registry does not list yet.',
          'A new release takes a minute or two to reach the whole registry. Extension.js tried 2 times over 1 second.',
          'Run the command again in a minute. The npm error is printed above.'
        ].join('\n')
      )
    })

    it('says the registry is having trouble after a 503 on every attempt', async () => {
      resolvePackageManager.mockReturnValue({name: 'bun'})
      execInstallCommand.mockRejectedValue(
        installFailure(CAPTURED_INSTALL_FAILURES['bun-tarball-503'])
      )

      const error: any = await ensureUserProjectDependencies(
        '/nonexistent-project' as any,
        {sleep}
      ).catch((caught) => caught)

      expect(execInstallCommand).toHaveBeenCalledTimes(4)
      expect(stripVTControlCharacters(error.message)).toContain(
        'The registry did not answer the install (HTTP 503).\nThe registry is having trouble answering right now.'
      )
    })

    it('does not wait on a range the project itself wrote', async () => {
      const project = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-eda-range-'))

      try {
        fs.writeFileSync(
          path.join(project, 'package.json'),
          JSON.stringify({name: 'ext', dependencies: {'stubx-late': '^9.0.0'}})
        )

        resolvePackageManager.mockReturnValue({name: 'npm'})
        execInstallCommand.mockRejectedValue(
          installFailure(CAPTURED_INSTALL_FAILURES['npm-version-direct'])
        )

        await expect(
          ensureUserProjectDependencies(project as any, {sleep})
        ).rejects.toThrow(
          'npm exited with code 1. The npm error is printed above.'
        )

        expect(execInstallCommand).toHaveBeenCalledTimes(1)
        expect(sleep).not.toHaveBeenCalled()
      } finally {
        fs.rmSync(project, {recursive: true, force: true})
      }
    })

    it.each([
      'missing-package',
      'auth'
    ])('does not wait on a failure that cannot heal (%s)', async (scenario) => {
      resolvePackageManager.mockReturnValue({name: 'npm'})
      execInstallCommand.mockRejectedValue(
        installFailure(CAPTURED_INSTALL_FAILURES[`npm-${scenario}`])
      )

      await expect(
        ensureUserProjectDependencies('/nonexistent-project' as any, {sleep})
      ).rejects.toThrow(
        'npm exited with code 1. The npm error is printed above.'
      )

      expect(execInstallCommand).toHaveBeenCalledTimes(1)
      expect(sleep).not.toHaveBeenCalled()
    })

    it.each([
      [
        'deno',
        'deno-age-direct',
        [
          "⏵⏵⏵ Error: Couldn't install the project dependencies with deno.",
          'Deno refuses releases younger than its minimum dependency age, and the newest release matching stubx-late@^4.0.3 is too young.',
          'Wait until the release is old enough, pin the previous version, or set minimumDependencyAge in deno.json.',
          'The deno error is printed above.'
        ]
      ],
      [
        'deno',
        'deno-age-transitive',
        [
          "⏵⏵⏵ Error: Couldn't install the project dependencies with deno.",
          'Deno refuses releases younger than its minimum dependency age, and the newest release matching stubx-late@^4.0.3 is too young.',
          'Wait until the release is old enough, pin the previous version, or set minimumDependencyAge in deno.json.',
          'The deno error is printed above.'
        ]
      ],
      [
        'pnpm',
        'pnpm-age-direct',
        [
          "⏵⏵⏵ Error: Couldn't install the project dependencies with pnpm.",
          'pnpm refuses releases younger than minimumReleaseAge allows, and stubx-late@4.0.3 is too young.',
          'Wait until the release is old enough, pin the previous version, or add the package to the minimumReleaseAgeExclude setting.',
          'The pnpm error is printed above.'
        ]
      ],
      [
        'pnpm',
        'pnpm10-age-transitive',
        [
          "⏵⏵⏵ Error: Couldn't install the project dependencies with pnpm.",
          'pnpm refuses releases younger than minimumReleaseAge allows, and stubx-late@4.0.3 is too young.',
          'Wait until the release is old enough, pin the previous version, or add the package to the minimumReleaseAgeExclude setting.',
          'The pnpm error is printed above.'
        ]
      ]
    ])('names the age rule once, without a wait or an npm install, when %s refuses a young release (%s)', async (manager, capture, framed) => {
      resolvePackageManager.mockReturnValue({name: manager})
      execInstallCommand.mockRejectedValue(
        installFailure(CAPTURED_INSTALL_FAILURES[capture])
      )

      const error: any = await ensureUserProjectDependencies(
        '/nonexistent-project' as any,
        {sleep}
      ).catch((caught) => caught)

      expect(error.code).toBe('E_DEPENDENCY_INSTALL')
      expect(stripVTControlCharacters(error.message)).toBe(framed.join('\n'))
      expect(execInstallCommand).toHaveBeenCalledTimes(1)
      expect(sleep).not.toHaveBeenCalled()
    })

    it('never installs with npm when another manager fails for a reason that cannot heal', async () => {
      resolvePackageManager.mockReturnValue({name: 'pnpm'})
      execInstallCommand.mockRejectedValue(
        installFailure(CAPTURED_INSTALL_FAILURES['pnpm-missing-package'])
      )

      const error: any = await ensureUserProjectDependencies(
        '/nonexistent-project' as any,
        {sleep}
      ).catch((caught) => caught)

      expect(execInstallCommand).toHaveBeenCalledTimes(1)
      expect(sleep).not.toHaveBeenCalled()
      expect(error.code).toBe('E_DEPENDENCY_INSTALL')
      expect(stripVTControlCharacters(error.message)).toBe(
        [
          "⏵⏵⏵ Error: Couldn't install the project dependencies with pnpm.",
          'pnpm exited with code 1. The pnpm error is printed above.',
          'Fix it, or run pnpm install yourself, then run the command again.'
        ].join('\n')
      )
    })
  })
})
