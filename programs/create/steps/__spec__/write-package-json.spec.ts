import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import type {VersionProbe} from '../../lib/package-manager'
import {
  overridePackageJson,
  resolveExtensionDevDependencyVersion
} from '../write-package-json'

async function withTempDir<T>(fn: (dir: string) => Promise<T>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'extjs-create-pkg-'))

  try {
    return await fn(dir)
  } finally {
    await fs.rm(dir, {recursive: true, force: true})
  }
}

function invokedWith(
  manager: 'npm' | 'pnpm' | 'yarn' | 'bun',
  version = '1.0.0'
) {
  vi.stubEnv('npm_config_user_agent', `${manager}/${version} node/v22.12.0`)
  vi.stubEnv('npm_execpath', '')
  vi.stubEnv('NPM_EXEC_PATH', '')
}

async function withGitIdentity<T>(
  identity: {name: string; email: string} | undefined,
  fn: () => Promise<T>
) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'extjs-create-ident-'))
  const configPath = path.join(dir, 'gitconfig')
  await fs.writeFile(
    configPath,
    identity
      ? `[user]\n\tname = ${identity.name}\n\temail = ${identity.email}\n`
      : '[core]\n\tpager = cat\n'
  )

  vi.stubEnv('GIT_CONFIG_GLOBAL', configPath)
  vi.stubEnv('GIT_CONFIG_SYSTEM', '/dev/null')

  try {
    return await fn()
  } finally {
    await fs.rm(dir, {recursive: true, force: true})
  }
}

describe('overridePackageJson template-aware scripts', () => {
  it('pins prerelease extension versions without semver range prefix', async () => {
    await withTempDir(async (projectPath) => {
      await fs.writeFile(
        path.join(projectPath, 'package.json'),
        JSON.stringify({
          name: 'seed',
          private: true,
          scripts: {}
        })
      )

      await overridePackageJson(
        projectPath,
        {
          cliVersion: '3.8.7-canary.205.b380650'
        },
        console
      )

      const pkg = JSON.parse(
        await fs.readFile(path.join(projectPath, 'package.json'), 'utf8')
      )

      expect(pkg.devDependencies.extension).toBe('3.8.7-canary.205.b380650')
    })
  })

  it('uses caret range for stable extension versions', async () => {
    await withTempDir(async (projectPath) => {
      await fs.writeFile(
        path.join(projectPath, 'package.json'),
        JSON.stringify({
          name: 'seed',
          private: true,
          scripts: {}
        })
      )

      await overridePackageJson(
        projectPath,
        {
          cliVersion: '3.8.7'
        },
        console
      )

      const pkg = JSON.parse(
        await fs.readFile(path.join(projectPath, 'package.json'), 'utf8')
      )

      expect(pkg.devDependencies.extension).toBe('^3.8.7')
    })
  })

  it('uses local CLI binary when create provides a local develop root', async () => {
    await withTempDir(async (projectPath) => {
      const prevDevelopRoot = process.env.EXTENSION_CREATE_DEVELOP_ROOT
      const developRoot = path.join(projectPath, 'programs', 'develop')
      const localCliPath = path.join(
        projectPath,
        'programs',
        'cli',
        'dist',
        'cli.cjs'
      )

      await fs.mkdir(path.dirname(localCliPath), {recursive: true})
      await fs.writeFile(localCliPath, 'module.exports = {}')

      await fs.writeFile(
        path.join(projectPath, 'package.json'),
        JSON.stringify({
          name: 'seed',
          private: true,
          scripts: {}
        })
      )

      process.env.EXTENSION_CREATE_DEVELOP_ROOT = developRoot

      try {
        await overridePackageJson(
          projectPath,
          {
            cliVersion: '0.0.1'
          },
          console
        )
      } finally {
        if (typeof prevDevelopRoot === 'undefined') {
          delete process.env.EXTENSION_CREATE_DEVELOP_ROOT
        } else {
          process.env.EXTENSION_CREATE_DEVELOP_ROOT = prevDevelopRoot
        }
      }

      const pkg = JSON.parse(
        await fs.readFile(path.join(projectPath, 'package.json'), 'utf8')
      )

      expect(pkg.scripts.dev).toContain(localCliPath)
      expect(pkg.scripts.start).toContain(localCliPath)
      expect(pkg.scripts.build).toContain(localCliPath)
      expect(pkg.scripts.preview).toContain(localCliPath)
    })
  })

  it('targets packages/extension for any monorepo template name', async () => {
    await withTempDir(async (projectPath) => {
      await fs.writeFile(
        path.join(projectPath, 'package.json'),
        JSON.stringify({
          name: 'seed',
          private: true,
          scripts: {}
        })
      )

      await overridePackageJson(
        projectPath,
        {
          template: 'custom-monorepo-template',
          cliVersion: '0.0.1'
        },
        console
      )

      const pkg = JSON.parse(
        await fs.readFile(path.join(projectPath, 'package.json'), 'utf8')
      )

      expect(pkg.scripts['build:chrome']).toContain('packages/extension')
      expect(pkg.scripts.dev).toContain('packages/extension')
      expect(pkg.scripts.start).toContain('packages/extension')
      expect(pkg.scripts.build).toContain('packages/extension')
      expect(pkg.scripts.preview).toContain('packages/extension')
      expect(pkg.scripts['build:firefox']).toContain('packages/extension')
      expect(pkg.scripts['build:edge']).toContain('packages/extension')
    })
  })

  it('does not override existing dev/build/start/preview scripts', async () => {
    await withTempDir(async (projectPath) => {
      await fs.writeFile(
        path.join(projectPath, 'package.json'),
        JSON.stringify({
          name: 'seed',
          private: true,
          scripts: {
            dev: 'custom dev',
            start: 'custom start',
            build: 'custom build',
            preview: 'custom preview'
          }
        })
      )

      await overridePackageJson(
        projectPath,
        {
          template: 'custom-monorepo-template',
          cliVersion: '0.0.1'
        },
        console
      )

      const pkg = JSON.parse(
        await fs.readFile(path.join(projectPath, 'package.json'), 'utf8')
      )

      expect(pkg.scripts.dev).toBe('custom dev')
      expect(pkg.scripts.start).toBe('custom start')
      expect(pkg.scripts.build).toBe('custom build')
      expect(pkg.scripts.preview).toBe('custom preview')
    })
  })
})

describe('resolveExtensionDevDependencyVersion (#57, never silently pin "latest")', () => {
  const saved = {
    engine: process.env.EXTENSION_CREATE_ENGINE_VERSION,
    mcp: process.env.EXTENSION_MCP_CLI_VERSION
  }
  afterEach(() => {
    for (const key of [
      'EXTENSION_CREATE_ENGINE_VERSION',
      'EXTENSION_MCP_CLI_VERSION'
    ]) {
      delete process.env[key]
    }

    if (saved.engine !== undefined) {
      process.env.EXTENSION_CREATE_ENGINE_VERSION = saved.engine
    }

    if (saved.mcp !== undefined) {
      process.env.EXTENSION_MCP_CLI_VERSION = saved.mcp
    }
  })

  it('caret-ranges a stable caller version, pins a prerelease exactly', () => {
    expect(resolveExtensionDevDependencyVersion('4.0.13')).toBe('^4.0.13')
    expect(resolveExtensionDevDependencyVersion('4.0.14-canary.123.abc')).toBe(
      '4.0.14-canary.123.abc'
    )
  })

  it('falls back to an env override when the caller threads no version', () => {
    delete process.env.EXTENSION_CREATE_ENGINE_VERSION
    process.env.EXTENSION_MCP_CLI_VERSION = '4.0.14-canary.999.deadbeef'
    expect(resolveExtensionDevDependencyVersion()).toBe(
      '4.0.14-canary.999.deadbeef'
    )

    process.env.EXTENSION_CREATE_ENGINE_VERSION = '4.1.0'
    expect(resolveExtensionDevDependencyVersion()).toBe('^4.1.0')
  })

  it('pins its own lockstep package version instead of "latest" when nothing is provided', () => {
    delete process.env.EXTENSION_CREATE_ENGINE_VERSION
    delete process.env.EXTENSION_MCP_CLI_VERSION
    const ownVersion = JSON.parse(
      require('node:fs').readFileSync(
        path.join(__dirname, '..', '..', 'package.json'),
        'utf8'
      )
    ).version as string
    const resolved = resolveExtensionDevDependencyVersion()
    expect(resolved).not.toBe('latest')
    const expected = ownVersion.includes('-') ? ownVersion : `^${ownVersion}`
    expect(resolved).toBe(expected)
  })
})

describe('overridePackageJson author identity', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('drops a template author block entirely, leaving no author key', async () => {
    await withTempDir(async (projectPath) => {
      await fs.writeFile(
        path.join(projectPath, 'package.json'),
        JSON.stringify({
          name: 'seed',
          private: true,
          author: {
            name: 'Template Author',
            email: 'template@example.com',
            url: 'https://template.example.com'
          }
        })
      )

      await withGitIdentity(undefined, () =>
        overridePackageJson(projectPath, {cliVersion: '4.0.1'}, console)
      )

      const raw = await fs.readFile(
        path.join(projectPath, 'package.json'),
        'utf8'
      )
      expect(Object.keys(JSON.parse(raw))).not.toContain('author')
      expect(raw).not.toContain('Template Author')
      expect(raw).not.toContain('template@example.com')
      expect(raw).not.toContain('https://template.example.com')
    })
  })

  it('does not guess an author from git config either', async () => {
    await withTempDir(async (projectPath) => {
      await fs.writeFile(
        path.join(projectPath, 'package.json'),
        JSON.stringify({
          name: 'seed',
          private: true,
          author: {name: 'Template Author', email: 'template@example.com'}
        })
      )

      await withGitIdentity(
        {name: 'Scaffold Tester', email: 'scaffold@example.com'},
        () => overridePackageJson(projectPath, {cliVersion: '4.0.1'}, console)
      )

      const raw = await fs.readFile(
        path.join(projectPath, 'package.json'),
        'utf8'
      )
      expect(Object.keys(JSON.parse(raw))).not.toContain('author')
      expect(raw).not.toContain('Scaffold Tester')
      expect(raw).not.toContain('scaffold@example.com')
    })
  })

  it('writes no placeholder author when the template ships none', async () => {
    await withTempDir(async (projectPath) => {
      await fs.writeFile(
        path.join(projectPath, 'package.json'),
        JSON.stringify({name: 'seed', private: true})
      )

      await withGitIdentity(undefined, () =>
        overridePackageJson(projectPath, {cliVersion: '4.0.1'}, console)
      )

      const raw = await fs.readFile(
        path.join(projectPath, 'package.json'),
        'utf8'
      )
      expect(JSON.parse(raw).author).toBeUndefined()
      expect(raw).not.toContain('Your Name')
      expect(raw).not.toContain('your@email.com')
    })
  })
})

describe('overridePackageJson dependency build-script approval', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('suppresses the no-op `less` build script for a pnpm scaffold', async () => {
    invokedWith('pnpm', '10.28.0')
    await withTempDir(async (projectPath) => {
      await fs.writeFile(
        path.join(projectPath, 'package.json'),
        JSON.stringify({name: 'seed', private: true})
      )

      await overridePackageJson(projectPath, {cliVersion: '4.0.1'}, console)

      const pkg = JSON.parse(
        await fs.readFile(path.join(projectPath, 'package.json'), 'utf8')
      )

      expect(pkg.pnpm.ignoredBuiltDependencies).toContain('less')
      expect(pkg.pnpm.onlyBuiltDependencies).toBeUndefined()
      expect(pkg.trustedDependencies).toBeUndefined()
    })
  })

  it('writes no pnpm settings block for a scaffold pnpm never installs', async () => {
    invokedWith('npm', '11.11.0')
    await withTempDir(async (projectPath) => {
      await fs.writeFile(
        path.join(projectPath, 'package.json'),
        JSON.stringify({name: 'seed', private: true})
      )

      await overridePackageJson(projectPath, {cliVersion: '4.0.1'}, console)

      const raw = await fs.readFile(
        path.join(projectPath, 'package.json'),
        'utf8'
      )
      expect(JSON.parse(raw).pnpm).toBeUndefined()
      expect(raw).not.toContain('ignoredBuiltDependencies')
    })
  })

  it('keeps the suppression when the template pins pnpm itself', async () => {
    invokedWith('npm', '11.11.0')
    await withTempDir(async (projectPath) => {
      await fs.writeFile(
        path.join(projectPath, 'package.json'),
        JSON.stringify({
          name: 'seed',
          private: true,
          packageManager: 'pnpm@10.28.0'
        })
      )

      await overridePackageJson(projectPath, {cliVersion: '4.0.1'}, console)

      const pkg = JSON.parse(
        await fs.readFile(path.join(projectPath, 'package.json'), 'utf8')
      )

      expect(pkg.pnpm.ignoredBuiltDependencies).toContain('less')
    })
  })

  it('approves native ML build scripts (pnpm + bun) when the transformers stack is present', async () => {
    invokedWith('pnpm', '10.28.0')
    await withTempDir(async (projectPath) => {
      await fs.writeFile(
        path.join(projectPath, 'package.json'),
        JSON.stringify({
          name: 'seed',
          private: true,
          dependencies: {'@huggingface/transformers': '3.7.1'}
        })
      )

      await overridePackageJson(projectPath, {cliVersion: '4.0.1'}, console)

      const pkg = JSON.parse(
        await fs.readFile(path.join(projectPath, 'package.json'), 'utf8')
      )

      expect(pkg.pnpm.onlyBuiltDependencies).toEqual(
        expect.arrayContaining(['onnxruntime-node', 'sharp', 'protobufjs'])
      )

      expect(pkg.pnpm.ignoredBuiltDependencies).toContain('less')
      expect(pkg.trustedDependencies).toEqual(
        expect.arrayContaining(['onnxruntime-node', 'sharp', 'protobufjs'])
      )
    })
  })

  it('merges with build-script config a template already declares', async () => {
    invokedWith('pnpm', '10.28.0')
    await withTempDir(async (projectPath) => {
      await fs.writeFile(
        path.join(projectPath, 'package.json'),
        JSON.stringify({
          name: 'seed',
          private: true,
          pnpm: {onlyBuiltDependencies: ['esbuild']}
        })
      )

      await overridePackageJson(projectPath, {cliVersion: '4.0.1'}, console)

      const pkg = JSON.parse(
        await fs.readFile(path.join(projectPath, 'package.json'), 'utf8')
      )

      expect(pkg.pnpm.onlyBuiltDependencies).toContain('esbuild')
      expect(pkg.pnpm.ignoredBuiltDependencies).toContain('less')
    })
  })
})

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')

// A template's package.json carries its author's dependencies and scripts.
// Replacing one that does not parse with a minimal file dropped all of them
// and still reported a finished scaffold.
describe('overridePackageJson with a template package.json it cannot use', () => {
  const noProbe = {
    packageManager: 'npm' as const,
    probeVersion: () => ({status: 1, stdout: ''})
  }

  function recordingLogger() {
    const errors: unknown[] = []

    return {errors, log() {}, error: (...args: unknown[]) => errors.push(args)}
  }

  it.each([
    [
      'is cut short',
      '{"name": "seed", "dependencies": {"react": "^19.0.0"}',
      SyntaxError,
      /^REASON unexpected end of the file at line 1 column 54$/
    ],
    [
      'holds a list and not an object',
      '["react"]',
      TypeError,
      /does not hold a JSON object/
    ]
  ])('refuses one that %s and leaves the file as it was', async (_label, contents, causeType, reason) => {
    await withTempDir(async (projectPath) => {
      const packageJsonPath = path.join(projectPath, 'package.json')
      await fs.writeFile(packageJsonPath, contents)
      const logger = recordingLogger()

      const error = (await overridePackageJson(projectPath, noProbe, logger)
        .then(() => new Error('the step did not refuse'))
        .catch((thrown: Error) => thrown)) as Error & {cause?: unknown}
      const frame = String(error.message).replace(ANSI, '').split('\n')

      expect(frame.slice(0, 2)).toEqual([
        "⏵⏵⏵ Error: Couldn't read the template's package.json.",
        `PATH ${packageJsonPath}`
      ])

      expect(frame[2]).toMatch(/^REASON /)
      expect(frame[2]).toMatch(reason)
      expect(frame[3]).toBe('Fix that file in the template, then create again.')
      expect(frame).toHaveLength(4)
      expect(error.cause).toBeInstanceOf(causeType)
      expect(logger.errors).toEqual([])
      // Nothing was written over the template's own bytes.
      expect(await fs.readFile(packageJsonPath, 'utf8')).toBe(contents)
    })
  })

  it('still writes a minimal package.json for a template that ships none', async () => {
    await withTempDir(async (projectPath) => {
      const logger = recordingLogger()

      await overridePackageJson(
        projectPath,
        {...noProbe, cliVersion: '4.0.1'},
        logger
      )

      const pkg = JSON.parse(
        await fs.readFile(path.join(projectPath, 'package.json'), 'utf8')
      )

      expect(pkg).toMatchObject({
        name: path.basename(projectPath),
        private: true,
        dependencies: {},
        devDependencies: {extension: '^4.0.1'}
      })

      expect(pkg.scripts.dev).toBe('extension dev')
      expect(logger.errors).toEqual([])
    })
  })
})

// A project with no packageManager field still works, so the create goes on.
// What it may not do is drop the field and say nothing.
describe('overridePackageJson when the manager version cannot be learned', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  function linesLogger() {
    const lines: string[] = []

    const record = (...args: unknown[]) => {
      lines.push(args.map(String).join(' ').replace(ANSI, ''))
    }

    return {lines, log: record, error: record}
  }

  async function scaffoldWith(
    projectPath: string,
    manager: 'npm' | 'pnpm' | 'deno',
    probeVersion: VersionProbe
  ) {
    // No invoker to copy the version from, so the binary is the only source.
    vi.stubEnv('npm_config_user_agent', '')
    await fs.writeFile(path.join(projectPath, 'package.json'), '{"name":"x"}')
    const logger = linesLogger()

    await overridePackageJson(
      projectPath,
      {packageManager: manager, probeVersion, cliVersion: '4.0.1'},
      logger
    )

    const pkg = JSON.parse(
      await fs.readFile(path.join(projectPath, 'package.json'), 'utf8')
    )

    return {pkg, lines: logger.lines}
  }

  const timeout = Object.assign(new Error('spawnSync ETIMEDOUT'), {
    code: 'ETIMEDOUT'
  })
  const missing = Object.assign(new Error('spawn ENOENT'), {code: 'ENOENT'})

  it.each<[string, 'npm' | 'pnpm', Awaited<ReturnType<VersionProbe>>, string]>([
    [
      'is not installed',
      'pnpm',
      {status: null, stdout: '', error: missing},
      'pnpm is not on PATH'
    ],
    [
      'fails',
      'pnpm',
      {status: 2, stdout: ''},
      'pnpm --version exited with code 2'
    ],
    [
      'prints something else',
      'npm',
      {status: 0, stdout: 'hello\n'},
      'npm --version printed no version'
    ],
    [
      'cannot be started',
      'npm',
      {
        status: null,
        stdout: '',
        error: Object.assign(new Error('EACCES'), {code: 'EACCES'})
      },
      'npm --version could not start (EACCES)'
    ]
  ])('writes no field and says why when the binary %s', async (_label, manager, answer, reason) => {
    await withTempDir(async (projectPath) => {
      const {pkg, lines} = await scaffoldWith(
        projectPath,
        manager,
        () => answer
      )

      expect(pkg).not.toHaveProperty('packageManager')
      expect(pkg.devDependencies).toEqual({extension: '^4.0.1'})
      expect(lines).toEqual([
        '⏵⏵⏵ Warning: Left package.json without a packageManager field.\n' +
          `REASON ${reason}\n` +
          `The project is fine. Add "packageManager": "${manager}@<version>" to pin the manager.`
      ])
    })
  })

  const askedAgain =
    '⏵⏵⏵ npm --version did not answer within 5s. Asking once more, for up to 15s…'

  it('says it is asking again, then why no field was written, when the binary never answers', async () => {
    await withTempDir(async (projectPath) => {
      const {pkg, lines} = await scaffoldWith(projectPath, 'npm', () => ({
        status: null,
        stdout: '',
        error: timeout
      }))

      expect(pkg).not.toHaveProperty('packageManager')
      expect(lines).toEqual([
        askedAgain,
        '⏵⏵⏵ Warning: Left package.json without a packageManager field.\n' +
          'REASON npm --version did not answer within 15s\n' +
          'The project is fine. Add "packageManager": "npm@<version>" to pin the manager.'
      ])
    })
  })

  it('says it is asking again, then declares the manager once the second probe answers', async () => {
    await withTempDir(async (projectPath) => {
      const answers: Array<Awaited<ReturnType<VersionProbe>>> = [
        {status: null, stdout: '', error: timeout},
        {status: 0, stdout: 'npm notice from a wrapper\r\n10.9.2\r\n'}
      ]
      const {pkg, lines} = await scaffoldWith(
        projectPath,
        'npm',
        () => answers.shift() as Awaited<ReturnType<VersionProbe>>
      )

      expect(pkg.packageManager).toBe('npm@10.9.2')
      expect(answers).toEqual([])
      expect(lines).toEqual([askedAgain])
    })
  })

  // A template pin for another manager is replaced when a version is known,
  // so it is not kept when none is: the warning says the field is absent.
  it.each([
    ['names another manager', 'foo@1.0.0'],
    ['carries no version', 'npm']
  ])('drops a template pin that %s when no version is learned', async (_label, pin) => {
    await withTempDir(async (projectPath) => {
      vi.stubEnv('npm_config_user_agent', '')
      await fs.writeFile(
        path.join(projectPath, 'package.json'),
        JSON.stringify({name: 'x', packageManager: pin})
      )

      const logger = linesLogger()

      const written = await overridePackageJson(
        projectPath,
        {
          packageManager: 'npm',
          probeVersion: () => ({status: 2, stdout: ''}),
          cliVersion: '4.0.1'
        },
        logger
      )

      const pkg = JSON.parse(
        await fs.readFile(path.join(projectPath, 'package.json'), 'utf8')
      )

      expect(pkg).not.toHaveProperty('packageManager')
      expect(written).toEqual({})
      expect(logger.lines.join('\n')).toContain(
        'Left package.json without a packageManager field.'
      )
    })
  })

  it('prints nothing for Deno, which declares no manager by design', async () => {
    await withTempDir(async (projectPath) => {
      const {pkg, lines} = await scaffoldWith(projectPath, 'deno', () => {
        throw new Error('the version probe ran')
      })

      expect(pkg).not.toHaveProperty('packageManager')
      expect(lines).toEqual([])
    })
  })
})
