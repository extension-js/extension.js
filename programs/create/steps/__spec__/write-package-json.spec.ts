import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
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
    if (saved.engine !== undefined)
      process.env.EXTENSION_CREATE_ENGINE_VERSION = saved.engine
    if (saved.mcp !== undefined)
      process.env.EXTENSION_MCP_CLI_VERSION = saved.mcp
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

  it('writes the identity git will commit the scaffold with', async () => {
    await withTempDir(async (projectPath) => {
      await fs.writeFile(
        path.join(projectPath, 'package.json'),
        JSON.stringify({name: 'seed', private: true})
      )

      await withGitIdentity(
        {name: 'Scaffold Tester', email: 'scaffold@example.com'},
        () => overridePackageJson(projectPath, {cliVersion: '4.0.1'}, console)
      )

      const pkg = JSON.parse(
        await fs.readFile(path.join(projectPath, 'package.json'), 'utf8')
      )

      expect(pkg.author).toEqual({
        name: 'Scaffold Tester',
        email: 'scaffold@example.com'
      })
    })
  })

  it('omits the author when git cannot name one', async () => {
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

  it("never carries the template author's identity forward", async () => {
    await withTempDir(async (projectPath) => {
      await fs.writeFile(
        path.join(projectPath, 'package.json'),
        JSON.stringify({
          name: 'seed',
          private: true,
          author: {name: 'Template Author', email: 'template@example.com'}
        })
      )

      await withGitIdentity(undefined, () =>
        overridePackageJson(projectPath, {cliVersion: '4.0.1'}, console)
      )

      const raw = await fs.readFile(
        path.join(projectPath, 'package.json'),
        'utf8'
      )
      expect(raw).not.toContain('Template Author')
      expect(raw).not.toContain('template@example.com')
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
