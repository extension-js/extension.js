import * as fs from 'node:fs'
import os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import type {InstallRunner} from '../lib/install-runner'
import {shellQuote} from '../lib/utils'
import {
  buildOptionalInstallArgs,
  detectOptionalDependencies,
  installInternalDependencies,
  type OptionalDepsPlan,
  optionalInstallManager,
  resolveMissingOptionalDeps
} from '../steps/install-internal-deps'

type InstallCall = {
  command: string
  args: string[]
  opts: {cwd: string; stdio: string}
}

const installCalls: InstallCall[] = []
const installResult = {
  code: 0 as number | null,
  stdout: '',
  stderr: '',
  reason: undefined as string | undefined
}

// The runner is the only thing that spawns, so handing the step this one means
// no package manager ever starts and the result of an install is the test's.
const runInstall: InstallRunner = async (command, args, opts) => {
  installCalls.push({command, args, opts: {cwd: opts.cwd, stdio: opts.stdio}})

  return {...installResult}
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')
const plain = (text: string) => text.replace(ANSI, '')

const created: string[] = []

function makeTempDir(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  created.push(dir)

  return dir
}

function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), {recursive: true})
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2))
}

function makeProject(
  dependencies: Record<string, string> | undefined,
  files: string[] = []
) {
  const projectRoot = makeTempDir('extjs-project-')

  if (dependencies) {
    writeJson(path.join(projectRoot, 'package.json'), {
      name: 'demo',
      dependencies
    })
  }

  for (const file of files) {
    fs.writeFileSync(path.join(projectRoot, file), '{}')
  }

  return projectRoot
}

function makeDevelopRoot() {
  const developRoot = makeTempDir('extjs-develop-')
  writeJson(path.join(developRoot, 'package.json'), {name: 'extension-develop'})

  return developRoot
}

function recordingLogger() {
  const logs: string[] = []

  return {
    logs,
    logger: {
      log: (...args: unknown[]) => logs.push(plain(args.map(String).join(' '))),
      error: (...args: unknown[]) =>
        logs.push(plain(args.map(String).join(' ')))
    }
  }
}

const nothingResolves = () => false
const everythingResolves = () => true

beforeEach(() => {
  installCalls.length = 0
  Object.assign(installResult, {
    code: 0,
    stdout: '',
    stderr: '',
    reason: undefined
  })

  // The machine or the lane may export any of these, and each changes the run.
  vi.stubEnv('EXTENSION_ENV', undefined)
  vi.stubEnv('EXTENSION_SKIP_INTERNAL_INSTALL', undefined)
  vi.stubEnv('EXTENSION_CREATE_DEVELOP_ROOT', undefined)
  vi.stubEnv('EXTENSION_DEBUG', undefined)
  vi.stubEnv('EXTENSION_AUTHOR_MODE', undefined)
})

afterEach(() => {
  vi.unstubAllEnvs()

  for (const dir of created.splice(0)) {
    fs.rmSync(dir, {recursive: true, force: true})
  }
})

type DetectionCase = {
  name: string
  dependencies: Record<string, string> | undefined
  files: string[]
  plan: OptionalDepsPlan
}

describe('detectOptionalDependencies', () => {
  it.each<DetectionCase>([
    {
      name: 'a project with no tooling asks for nothing',
      dependencies: {},
      files: [],
      plan: {integrations: [], dependencies: [], dependenciesByIntegration: {}}
    },
    {
      name: 'React asks for the refresh runtime and its plugin',
      dependencies: {react: '^18.0.0'},
      files: [],
      plan: {
        integrations: ['React'],
        dependencies: ['react-refresh', '@rspack/plugin-react-refresh'],
        dependenciesByIntegration: {
          React: ['react-refresh', '@rspack/plugin-react-refresh']
        }
      }
    },
    {
      name: 'react-dom alone counts as React',
      dependencies: {'react-dom': '^18.0.0'},
      files: [],
      plan: {
        integrations: ['React'],
        dependencies: ['react-refresh', '@rspack/plugin-react-refresh'],
        dependenciesByIntegration: {
          React: ['react-refresh', '@rspack/plugin-react-refresh']
        }
      }
    },
    {
      name: 'React with Tailwind and a PostCSS config adds the PostCSS pair',
      dependencies: {react: '^18.0.0', tailwindcss: '^4.0.0'},
      files: ['postcss.config.js'],
      plan: {
        integrations: ['React', 'PostCSS'],
        dependencies: [
          'react-refresh',
          '@rspack/plugin-react-refresh',
          'postcss',
          'postcss-loader'
        ],
        dependenciesByIntegration: {
          React: ['react-refresh', '@rspack/plugin-react-refresh'],
          PostCSS: ['postcss', 'postcss-loader']
        }
      }
    },
    {
      name: 'a tsconfig.json alone counts as TypeScript',
      dependencies: undefined,
      files: ['tsconfig.json'],
      plan: {
        integrations: ['TypeScript'],
        dependencies: ['typescript'],
        dependenciesByIntegration: {TypeScript: ['typescript']}
      }
    },
    {
      name: 'Preact asks for prefresh and preact itself',
      dependencies: {preact: '^10.0.0'},
      files: [],
      plan: {
        integrations: ['Preact'],
        dependencies: [
          '@prefresh/core',
          '@prefresh/utils',
          '@rspack/plugin-preact-refresh',
          'preact'
        ],
        dependenciesByIntegration: {
          Preact: [
            '@prefresh/core',
            '@prefresh/utils',
            '@rspack/plugin-preact-refresh',
            'preact'
          ]
        }
      }
    },
    {
      name: 'Vue asks for its loader and the SFC compiler',
      dependencies: {vue: '^3.0.0'},
      files: [],
      plan: {
        integrations: ['Vue'],
        dependencies: ['vue-loader', '@vue/compiler-sfc'],
        dependenciesByIntegration: {Vue: ['vue-loader', '@vue/compiler-sfc']}
      }
    },
    {
      name: 'Svelte with TypeScript lists typescript once across both',
      dependencies: {svelte: '^5.0.0', typescript: '^5.0.0'},
      files: [],
      plan: {
        integrations: ['TypeScript', 'Svelte'],
        dependencies: ['typescript', 'svelte-loader'],
        dependenciesByIntegration: {
          TypeScript: ['typescript'],
          Svelte: ['svelte-loader', 'typescript']
        }
      }
    },
    {
      name: 'Svelte in a project with no TypeScript asks for its loader alone',
      dependencies: {svelte: '^5.0.0'},
      files: [],
      plan: {
        integrations: ['Svelte'],
        dependencies: ['svelte-loader'],
        dependenciesByIntegration: {Svelte: ['svelte-loader']}
      }
    },
    {
      name: 'Svelte beside a tsconfig.json asks for typescript too',
      dependencies: {svelte: '^5.0.0'},
      files: ['tsconfig.json'],
      plan: {
        integrations: ['TypeScript', 'Svelte'],
        dependencies: ['typescript', 'svelte-loader'],
        dependenciesByIntegration: {
          TypeScript: ['typescript'],
          Svelte: ['svelte-loader', 'typescript']
        }
      }
    },
    {
      name: 'Sass brings its own PostCSS loader, so PostCSS adds nothing',
      dependencies: {sass: '^1.0.0', postcss: '^8.0.0'},
      files: [],
      plan: {
        integrations: ['Sass', 'PostCSS'],
        dependencies: ['sass-loader', 'postcss-loader', 'postcss-scss'],
        dependenciesByIntegration: {
          Sass: ['sass-loader', 'postcss-loader', 'postcss-scss'],
          PostCSS: []
        }
      }
    },
    {
      name: 'Less asks for less and its loader',
      dependencies: {'less-loader': '^12.0.0'},
      files: [],
      plan: {
        integrations: ['Less'],
        dependencies: ['less', 'less-loader'],
        dependenciesByIntegration: {Less: ['less', 'less-loader']}
      }
    },
    {
      name: 'a Tailwind config file alone counts as PostCSS',
      dependencies: {},
      files: ['tailwind.config.js'],
      plan: {
        integrations: ['PostCSS'],
        dependencies: ['postcss', 'postcss-loader'],
        dependenciesByIntegration: {PostCSS: ['postcss', 'postcss-loader']}
      }
    }
  ])('$name', ({dependencies, files, plan}) => {
    const projectRoot = makeProject(dependencies, files)

    expect(detectOptionalDependencies(projectRoot)).toEqual(plan)
  })

  it('reads devDependencies as well as dependencies', () => {
    const projectRoot = makeTempDir('extjs-project-')
    writeJson(path.join(projectRoot, 'package.json'), {
      name: 'demo',
      devDependencies: {vue: '^3.0.0'}
    })

    expect(detectOptionalDependencies(projectRoot).integrations).toEqual([
      'Vue'
    ])
  })

  it('reads npm imports from a Deno project that has no package.json', () => {
    const projectRoot = makeTempDir('extjs-project-')
    writeJson(path.join(projectRoot, 'deno.json'), {
      imports: {react: 'npm:react@^18.0.0'}
    })

    expect(detectOptionalDependencies(projectRoot).integrations).toEqual([
      'React'
    ])
  })
})

describe('resolveMissingOptionalDeps', () => {
  const developRoot = path.join(path.sep, 'toolchain', 'extension-develop')
  const cwd = path.join(path.sep, 'somewhere', 'else')

  it('keeps every dependency when nothing resolves', () => {
    const projectRoot = makeProject({react: '^18.0.0', vue: '^3.0.0'})

    expect(
      resolveMissingOptionalDeps(developRoot, projectRoot, nothingResolves, cwd)
    ).toEqual({
      integrations: ['React', 'Vue'],
      dependencies: [
        'react-refresh',
        '@rspack/plugin-react-refresh',
        'vue-loader',
        '@vue/compiler-sfc'
      ],
      dependenciesByIntegration: {
        React: ['react-refresh', '@rspack/plugin-react-refresh'],
        Vue: ['vue-loader', '@vue/compiler-sfc']
      }
    })
  })

  it('drops what already resolves and the integrations left with nothing', () => {
    const projectRoot = makeProject({react: '^18.0.0', vue: '^3.0.0'})
    const present = new Set([
      'react-refresh',
      '@rspack/plugin-react-refresh',
      'vue-loader'
    ])

    expect(
      resolveMissingOptionalDeps(
        developRoot,
        projectRoot,
        (dependency) => present.has(dependency),
        cwd
      )
    ).toEqual({
      integrations: ['Vue'],
      dependencies: ['@vue/compiler-sfc'],
      dependenciesByIntegration: {Vue: ['@vue/compiler-sfc']}
    })
  })

  it('answers an empty plan when everything resolves', () => {
    const projectRoot = makeProject({react: '^18.0.0', sass: '^1.0.0'})

    expect(
      resolveMissingOptionalDeps(
        developRoot,
        projectRoot,
        everythingResolves,
        cwd
      )
    ).toEqual({
      integrations: [],
      dependencies: [],
      dependenciesByIntegration: {}
    })
  })

  it('looks in the toolchain, the project and the working directory, in that order', () => {
    const projectRoot = makeProject({vue: '^3.0.0'})
    const asked: Array<{dependency: string; paths: string[]}> = []

    resolveMissingOptionalDeps(
      developRoot,
      projectRoot,
      (dependency, paths) => {
        asked.push({dependency, paths})

        return false
      },
      cwd
    )

    expect(asked).toEqual([
      {dependency: 'vue-loader', paths: [developRoot, projectRoot, cwd]},
      {dependency: '@vue/compiler-sfc', paths: [developRoot, projectRoot, cwd]}
    ])
  })
})

describe('optional install arguments per package manager', () => {
  const installDir = path.join(path.sep, 'toolchain', 'extension-develop')
  const dependencies = ['react-refresh', '@rspack/plugin-react-refresh']

  it.each([
    {
      manager: 'npm',
      command: 'npm',
      argv: [
        'install',
        'react-refresh',
        '@rspack/plugin-react-refresh',
        '--save-optional',
        '--legacy-peer-deps'
      ]
    },
    {
      manager: 'pnpm',
      command: 'pnpm',
      argv: [
        'add',
        'react-refresh',
        '@rspack/plugin-react-refresh',
        '--dir',
        installDir,
        '--save-optional',
        '--silent'
      ]
    },
    {
      manager: 'yarn',
      command: 'yarn',
      argv: [
        'add',
        'react-refresh',
        '@rspack/plugin-react-refresh',
        '--optional'
      ]
    },
    {
      manager: 'bun',
      command: 'bun',
      argv: [
        'add',
        'react-refresh',
        '@rspack/plugin-react-refresh',
        '--cwd',
        installDir,
        '--optional'
      ]
    },
    {
      manager: 'deno',
      command: 'npm',
      argv: [
        'install',
        'react-refresh',
        '@rspack/plugin-react-refresh',
        '--save-optional',
        '--legacy-peer-deps'
      ]
    }
  ] as const)('$manager runs $command with its own flags', ({
    manager,
    command,
    argv
  }) => {
    const pm = optionalInstallManager(manager)

    expect(pm).toBe(command)
    expect(buildOptionalInstallArgs(pm, dependencies, installDir)).toEqual(argv)
  })
})

describe('pnpm optional install output', () => {
  const installDir = path.join(path.sep, 'toolchain', 'extension-develop')

  it('drops --silent when the run is shown live', () => {
    expect(
      buildOptionalInstallArgs('pnpm', ['vue-loader'], installDir, true)
    ).toEqual(['add', 'vue-loader', '--dir', installDir, '--save-optional'])
  })

  it('lets pnpm speak in development and keeps it silent otherwise', async () => {
    const developRoot = makeDevelopRoot()
    const projectRoot = makeProject({vue: '^3.0.0'})
    vi.stubEnv('EXTENSION_CREATE_DEVELOP_ROOT', developRoot)
    const install = () =>
      installInternalDependencies(
        projectRoot,
        recordingLogger().logger,
        'pnpm',
        undefined,
        nothingResolves,
        undefined,
        runInstall
      )

    await install()
    vi.stubEnv('EXTENSION_ENV', 'development')
    await install()

    const shared = [
      'add',
      'vue-loader',
      '@vue/compiler-sfc',
      '--dir',
      developRoot,
      '--save-optional'
    ]
    expect(installCalls).toEqual([
      {
        command: 'pnpm',
        args: [...shared, '--silent'],
        opts: {cwd: developRoot, stdio: 'pipe'}
      },
      {command: 'pnpm', args: shared, opts: {cwd: developRoot, stdio: 'tee'}}
    ])
  })
})

describe('installInternalDependencies', () => {
  it('refuses a package.json that exists but cannot be parsed, with one frame', async () => {
    const projectRoot = makeTempDir('extjs-project-')
    const manifestPath = path.join(projectRoot, 'package.json')
    fs.writeFileSync(manifestPath, '{"name": broken')
    vi.stubEnv('EXTENSION_CREATE_DEVELOP_ROOT', makeDevelopRoot())

    const {logger, logs} = recordingLogger()
    const error = (await installInternalDependencies(
      projectRoot,
      logger,
      'npm',
      undefined,
      nothingResolves,
      undefined,
      runInstall
    ).catch((thrown: Error) => thrown)) as Error & {cause?: unknown}
    const frame = plain(String(error.message))

    expect(frame.split('\n').slice(0, 2)).toEqual([
      "⏵⏵⏵ Error: Couldn't read the template's package.json.",
      `PATH ${manifestPath}`
    ])

    expect(frame.split('\n')[2]).toMatch(/^REASON .*JSON/)
    expect(frame.match(/⏵⏵⏵/g)).toHaveLength(1)
    expect(error.cause).toBeInstanceOf(SyntaxError)
    expect(logs).toEqual([])
    expect(installCalls).toEqual([])
  })

  // A Deno scaffold installs these with npm, so a machine with Deno alone
  // reaches a runner that rejects before any manager starts.
  it('frames a package manager that is not installed, with the spawn error as cause', async () => {
    const projectRoot = makeProject({vue: '^3.0.0'})
    vi.stubEnv('EXTENSION_CREATE_DEVELOP_ROOT', makeDevelopRoot())
    const spawnError = Object.assign(new Error('spawn npm ENOENT'), {
      code: 'ENOENT',
      syscall: 'spawn npm'
    })
    const asked: string[] = []

    const {logger, logs} = recordingLogger()
    const error = (await installInternalDependencies(
      projectRoot,
      logger,
      'deno',
      'vue',
      nothingResolves,
      undefined,
      async (command) => {
        asked.push(command)

        throw spawnError
      }
    ).catch((thrown: Error) => thrown)) as Error & {cause?: unknown}
    const frame = plain(String(error.message))

    expect(asked).toEqual(['npm'])
    expect(frame.split('\n').slice(0, 4)).toEqual([
      `⏵⏵⏵ Error: Couldn't install the dependencies for ${path.basename(projectRoot)}.`,
      'COMMAND npm install vue-loader @vue/compiler-sfc --save-optional --legacy-peer-deps',
      'REASON npm is not installed, or not on PATH',
      'Install npm or add it to PATH.'
    ])

    expect(frame).toContain('--template vue --install')
    expect(frame.match(/⏵⏵⏵/g)).toHaveLength(1)
    expect(frame).not.toMatch(/^\s+at /m)
    expect(error.cause).toBe(spawnError)
    // Only the progress line, on the log channel: the failure is the throw.
    expect(logs.map((line) => line.split('\n')[0])).toEqual([
      expect.stringMatching(/ Installing the dependencies for Vue…$/)
    ])
  })

  it('stays silent when package.json is simply absent', async () => {
    const projectRoot = makeTempDir('extjs-project-')
    vi.stubEnv('EXTENSION_CREATE_DEVELOP_ROOT', makeDevelopRoot())

    const {logger, logs} = recordingLogger()
    await installInternalDependencies(
      projectRoot,
      logger,
      'npm',
      undefined,
      nothingResolves,
      undefined,
      runInstall
    )

    expect(logs).toEqual([])
    expect(installCalls).toEqual([])
  })

  it('installs every missing integration into the develop root in one run', async () => {
    const developRoot = makeDevelopRoot()
    const projectRoot = makeProject({react: '^18.0.0', tailwindcss: '^4.0.0'}, [
      'postcss.config.js'
    ])
    vi.stubEnv('EXTENSION_CREATE_DEVELOP_ROOT', developRoot)

    const {logger, logs} = recordingLogger()
    await installInternalDependencies(
      projectRoot,
      logger,
      'pnpm',
      undefined,
      nothingResolves,
      undefined,
      runInstall
    )

    expect(installCalls).toEqual([
      {
        command: 'pnpm',
        args: [
          'add',
          'react-refresh',
          '@rspack/plugin-react-refresh',
          'postcss',
          'postcss-loader',
          '--dir',
          developRoot,
          '--save-optional',
          '--silent'
        ],
        opts: {cwd: developRoot, stdio: 'pipe'}
      }
    ])

    // One progress line that names every integration the run serves.
    expect(logs).toHaveLength(1)
    expect(logs[0].split('\n')).toEqual([
      expect.stringMatching(
        / Installing the dependencies for React and PostCSS…$/
      ),
      'This can take a moment.'
    ])
  })

  it('installs a package two integrations share once', async () => {
    const developRoot = makeDevelopRoot()
    const projectRoot = makeProject({svelte: '^5.0.0', typescript: '^5.0.0'})
    vi.stubEnv('EXTENSION_CREATE_DEVELOP_ROOT', developRoot)

    const {logger, logs} = recordingLogger()
    await installInternalDependencies(
      projectRoot,
      logger,
      'npm',
      undefined,
      nothingResolves,
      undefined,
      runInstall
    )

    expect(installCalls).toEqual([
      {
        command: 'npm',
        args: [
          'install',
          'typescript',
          'svelte-loader',
          '--save-optional',
          '--legacy-peer-deps'
        ],
        opts: {cwd: developRoot, stdio: 'pipe'}
      }
    ])

    expect(logs.map((line) => line.split('\n')[0])).toEqual([
      expect.stringMatching(
        / Installing the dependencies for TypeScript and Svelte…$/
      )
    ])
  })

  it('never asks for typescript in a Svelte project that has none', async () => {
    const developRoot = makeDevelopRoot()
    const projectRoot = makeProject({svelte: '^5.0.0'})
    vi.stubEnv('EXTENSION_CREATE_DEVELOP_ROOT', developRoot)

    await installInternalDependencies(
      projectRoot,
      recordingLogger().logger,
      'npm',
      undefined,
      nothingResolves,
      undefined,
      runInstall
    )

    expect(installCalls.map((call) => call.args)).toEqual([
      ['install', 'svelte-loader', '--save-optional', '--legacy-peer-deps']
    ])
  })

  it('installs with npm for a Deno scaffold', async () => {
    const developRoot = makeDevelopRoot()
    const projectRoot = makeProject({vue: '^3.0.0'})
    vi.stubEnv('EXTENSION_CREATE_DEVELOP_ROOT', developRoot)

    await installInternalDependencies(
      projectRoot,
      recordingLogger().logger,
      'deno',
      undefined,
      nothingResolves,
      undefined,
      runInstall
    )

    expect(installCalls).toEqual([
      {
        command: 'npm',
        args: [
          'install',
          'vue-loader',
          '@vue/compiler-sfc',
          '--save-optional',
          '--legacy-peer-deps'
        ],
        opts: {cwd: developRoot, stdio: 'pipe'}
      }
    ])
  })

  it('installs only what does not already resolve', async () => {
    const developRoot = makeDevelopRoot()
    const projectRoot = makeProject({react: '^18.0.0', vue: '^3.0.0'})
    vi.stubEnv('EXTENSION_CREATE_DEVELOP_ROOT', developRoot)

    await installInternalDependencies(
      projectRoot,
      recordingLogger().logger,
      'yarn',
      undefined,
      (dependency) => dependency !== '@vue/compiler-sfc',
      undefined,
      runInstall
    )

    expect(installCalls).toEqual([
      {
        command: 'yarn',
        args: ['add', '@vue/compiler-sfc', '--optional'],
        opts: {cwd: developRoot, stdio: 'pipe'}
      }
    ])
  })

  it('prefers the project local extension-develop over the CLI override', async () => {
    const projectRoot = makeProject({react: '^18.0.0'})
    const localDevelopRoot = path.join(
      projectRoot,
      'node_modules',
      'extension-develop'
    )
    writeJson(path.join(localDevelopRoot, 'package.json'), {
      name: 'extension-develop'
    })

    vi.stubEnv('EXTENSION_CREATE_DEVELOP_ROOT', makeDevelopRoot())

    await installInternalDependencies(
      projectRoot,
      recordingLogger().logger,
      'npm',
      undefined,
      nothingResolves,
      undefined,
      runInstall
    )

    expect(installCalls.map((call) => call.opts.cwd)).toEqual([
      localDevelopRoot
    ])
  })

  it('names the create to run again when an optional install fails', async () => {
    const developRoot = makeDevelopRoot()
    const projectRoot = makeProject({react: '^18.0.0', vue: '^3.0.0'})
    vi.stubEnv('EXTENSION_CREATE_DEVELOP_ROOT', developRoot)
    Object.assign(installResult, {
      code: 1,
      stdout: '',
      stderr: 'npm error code E404\nnpm error 404 Not Found'
    })

    const error = await installInternalDependencies(
      projectRoot,
      recordingLogger().logger,
      'npm',
      'react',
      nothingResolves,
      undefined,
      runInstall
    ).then(
      () => {
        throw new Error('expected the optional install to reject')
      },
      (thrown: Error) => thrown
    )

    expect(plain(error.message)).toContain(
      "Couldn't install the dependencies.\n" +
        'COMMAND npm install react-refresh @rspack/plugin-react-refresh vue-loader @vue/compiler-sfc --save-optional --legacy-peer-deps\n' +
        'EXIT 1\n' +
        'REASON npm error code E404\nnpm error 404 Not Found\n' +
        'The new project files were removed. Fix the error above, then run ' +
        `extension create ${shellQuote(projectRoot)} --template react --install again.`
    )

    // React and Vue share the one run, so one failure is the whole story.
    expect(installCalls).toHaveLength(1)
  })

  it('shows the output live in development and still frames the reason', async () => {
    const developRoot = makeDevelopRoot()
    const projectRoot = makeProject({vue: '^3.0.0'})
    vi.stubEnv('EXTENSION_CREATE_DEVELOP_ROOT', developRoot)
    vi.stubEnv('EXTENSION_ENV', 'development')
    Object.assign(installResult, {
      code: 1,
      stdout: '',
      stderr: 'npm error code E404\nnpm error 404 Not Found'
    })

    const error = await installInternalDependencies(
      projectRoot,
      recordingLogger().logger,
      'npm',
      'vue',
      nothingResolves,
      undefined,
      runInstall
    ).then(
      () => {
        throw new Error('expected the optional install to reject')
      },
      (thrown: Error) => thrown
    )

    // Tee, not inherit: an inherited stream leaves nothing to put in the frame.
    expect(installCalls.map((call) => call.opts.stdio)).toEqual(['tee'])
    expect(plain(error.message)).toContain(
      "Couldn't install the dependencies.\n" +
        'COMMAND npm install vue-loader @vue/compiler-sfc --save-optional --legacy-peer-deps\n' +
        'EXIT 1\n' +
        'REASON npm error code E404\nnpm error 404 Not Found\n' +
        'The new project files were removed.'
    )
  })

  it('names the timeout first when the runner ended a hung optional install', async () => {
    const developRoot = makeDevelopRoot()
    const projectRoot = makeProject({react: '^18.0.0'})
    vi.stubEnv('EXTENSION_CREATE_DEVELOP_ROOT', developRoot)
    Object.assign(installResult, {
      code: null,
      stdout: 'still resolving\n',
      stderr: '',
      reason:
        'The install did not finish within 1800 seconds (EXTENSION_CREATE_INSTALL_TIMEOUT_MS)'
    })

    const error = await installInternalDependencies(
      projectRoot,
      recordingLogger().logger,
      'npm',
      'react',
      nothingResolves,
      undefined,
      runInstall
    ).then(
      () => {
        throw new Error('expected the optional install to reject')
      },
      (thrown: Error) => thrown
    )

    expect(error.name).toBe('Error')
    expect(plain(error.message)).toContain(
      "Couldn't install the dependencies.\n" +
        'COMMAND npm install react-refresh @rspack/plugin-react-refresh --save-optional --legacy-peer-deps\n' +
        'EXIT null\n' +
        'REASON The install did not finish within 1800 seconds (EXTENSION_CREATE_INSTALL_TIMEOUT_MS)\n' +
        'still resolving\n' +
        'The new project files were removed.'
    )
  })

  it.each([
    'true',
    '1',
    'TRUE',
    ' 1 '
  ])('installs nothing when EXTENSION_SKIP_INTERNAL_INSTALL is "%s"', async (value) => {
    const projectRoot = makeProject({react: '^18.0.0'})
    vi.stubEnv('EXTENSION_CREATE_DEVELOP_ROOT', makeDevelopRoot())
    vi.stubEnv('EXTENSION_SKIP_INTERNAL_INSTALL', value)

    const {logger, logs} = recordingLogger()
    await installInternalDependencies(
      projectRoot,
      logger,
      'npm',
      undefined,
      nothingResolves,
      undefined,
      runInstall
    )

    expect(installCalls).toEqual([])
    expect(logs).toEqual([])
  })

  it.each([
    'false',
    '0',
    ''
  ])('still installs when EXTENSION_SKIP_INTERNAL_INSTALL is "%s"', async (value) => {
    const projectRoot = makeProject({react: '^18.0.0'})
    vi.stubEnv('EXTENSION_CREATE_DEVELOP_ROOT', makeDevelopRoot())
    vi.stubEnv('EXTENSION_SKIP_INTERNAL_INSTALL', value)

    await installInternalDependencies(
      projectRoot,
      recordingLogger().logger,
      'npm',
      undefined,
      nothingResolves,
      undefined,
      runInstall
    )

    expect(installCalls).toHaveLength(1)
  })

  it('spawns nothing when every optional dependency already resolves', async () => {
    const projectRoot = makeProject(
      {react: '^18.0.0', sass: '^1.0.0', typescript: '^5.0.0'},
      ['postcss.config.js']
    )
    vi.stubEnv('EXTENSION_CREATE_DEVELOP_ROOT', makeDevelopRoot())

    const {logger, logs} = recordingLogger()
    await installInternalDependencies(
      projectRoot,
      logger,
      'npm',
      undefined,
      everythingResolves,
      undefined,
      runInstall
    )

    expect(installCalls).toEqual([])
    expect(logs).toEqual([])
  })
})
