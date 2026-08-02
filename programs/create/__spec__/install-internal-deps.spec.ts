import * as fs from 'node:fs'
import os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const created: string[] = []

const spawnCalls = vi.hoisted(
  () => [] as Array<{command: string; args: string[]; cwd?: string}>
)

vi.mock('cross-spawn', () => ({
  spawn: (command: string, args: string[], opts: any) => {
    spawnCalls.push({command, args, cwd: opts?.cwd})
    const listeners: Record<string, Function[]> = {close: [], error: []}
    return {
      stdout: {on: () => undefined},
      stderr: {on: () => undefined},
      on: (evt: 'close' | 'error', cb: Function) => {
        listeners[evt].push(cb)
        if (evt === 'close') {
          setImmediate(() => cb(0))
        }
      }
    } as any
  }
}))

function makeTempDir(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  created.push(dir)
  return dir
}

function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), {recursive: true})
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2))
}

describe('install-internal-deps', () => {
  const originalEnv = process.env

  const itCleanEnv = process.env.CI ? it.skip : it

  beforeEach(() => {
    vi.resetModules()
    process.env = {...originalEnv}
    spawnCalls.length = 0
  })

  afterEach(() => {
    for (const d of created) {
      try {
        fs.rmSync(d, {recursive: true, force: true})
      } catch {
        // Ignore
      }
    }
    created.length = 0
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  it('warns loudly when package.json exists but cannot be parsed', async () => {
    const developRoot = makeTempDir('extjs-develop-')
    const projectRoot = makeTempDir('extjs-project-')

    writeJson(path.join(developRoot, 'package.json'), {
      name: 'extension-develop'
    })
    fs.writeFileSync(path.join(projectRoot, 'package.json'), '{"name": broken')

    process.env.EXTENSION_CREATE_DEVELOP_ROOT = developRoot
    process.env.EXTENSION_ENV = 'development'

    const logs: string[] = []
    const logger = {
      log: (...args: unknown[]) => logs.push(args.map(String).join(' ')),
      error: (...args: unknown[]) => logs.push(args.map(String).join(' '))
    }

    const mod = await import('../steps/install-internal-deps')
    await mod.installInternalDependencies(projectRoot, logger)

    // The malformed manifest is named, and nothing is installed silently.
    const warning = logs.find((line) => line.includes('package.json'))
    expect(warning).toBeDefined()
    expect(warning).toContain(path.join(projectRoot, 'package.json'))
    expect(spawnCalls.length).toBe(0)
  })

  it('stays silent when package.json is simply absent', async () => {
    const developRoot = makeTempDir('extjs-develop-')
    const projectRoot = makeTempDir('extjs-project-')

    writeJson(path.join(developRoot, 'package.json'), {
      name: 'extension-develop'
    })

    process.env.EXTENSION_CREATE_DEVELOP_ROOT = developRoot
    process.env.EXTENSION_ENV = 'development'

    const logs: string[] = []
    const logger = {
      log: (...args: unknown[]) => logs.push(args.map(String).join(' ')),
      error: (...args: unknown[]) => logs.push(args.map(String).join(' '))
    }

    const mod = await import('../steps/install-internal-deps')
    await mod.installInternalDependencies(projectRoot, logger)

    expect(logs.find((line) => line.includes('package.json'))).toBeUndefined()
  })

  itCleanEnv('installs missing optional deps into develop root', async () => {
    const developRoot = makeTempDir('extjs-develop-')
    const projectRoot = makeTempDir('extjs-project-')

    writeJson(path.join(developRoot, 'package.json'), {
      name: 'extension-develop'
    })

    writeJson(path.join(projectRoot, 'package.json'), {
      name: 'demo',
      dependencies: {react: '^18.0.0', tailwindcss: '^4.0.0'}
    })
    fs.writeFileSync(
      path.join(projectRoot, 'postcss.config.js'),
      'module.exports = {}'
    )

    process.env.EXTENSION_CREATE_DEVELOP_ROOT = developRoot
    process.env.npm_config_user_agent = 'npm/9.0.0'
    process.env.EXTENSION_ENV = 'development'

    const cwd = process.cwd()
    process.chdir(projectRoot)

    const mod = await import('../steps/install-internal-deps')
    await mod.installInternalDependencies(projectRoot, console)

    process.chdir(cwd)

    expect(spawnCalls.length).toBeGreaterThanOrEqual(1)

    const optionalCall = spawnCalls.find((call) => {
      const args = call.args.join(' ')
      return (
        args.includes('react-refresh') &&
        args.includes('@rspack/plugin-react-refresh')
      )
    })
    expect(optionalCall).toBeTruthy()
    expect(optionalCall.cwd).toBe(developRoot)
    const optionalArgs = optionalCall.args.join(' ')
    expect(optionalArgs).toContain('react-refresh')
    expect(optionalArgs).toContain('@rspack/plugin-react-refresh')
    expect(optionalArgs).not.toContain('--prefix')
    expect(optionalArgs).toContain('--save-optional')
    expect(optionalArgs).toContain('--legacy-peer-deps')
    const postCssCall = spawnCalls.find((call) => {
      const args = call.args.join(' ')
      return args.includes('postcss') && args.includes('postcss-loader')
    })
    expect(postCssCall).toBeTruthy()
  })

  itCleanEnv(
    'pnpm optional installs run silent like project installs',
    async () => {
      const developRoot = makeTempDir('extjs-develop-')
      const projectRoot = makeTempDir('extjs-project-')

      writeJson(path.join(developRoot, 'package.json'), {
        name: 'extension-develop'
      })
      writeJson(path.join(projectRoot, 'package.json'), {
        name: 'demo',
        dependencies: {react: '^18.0.0'}
      })

      process.env.EXTENSION_CREATE_DEVELOP_ROOT = developRoot
      process.env.npm_config_user_agent = 'pnpm/9.0.0'
      process.env.EXTENSION_ENV = 'development'

      const cwd = process.cwd()
      process.chdir(projectRoot)

      const mod = await import('../steps/install-internal-deps')
      await mod.installInternalDependencies(projectRoot, console)

      process.chdir(cwd)

      const optionalCall = spawnCalls.find((call) =>
        call.args.join(' ').includes('react-refresh')
      )
      expect(optionalCall).toBeTruthy()
      expect(optionalCall?.args[0]).toBe('add')
      expect(optionalCall?.args).toContain('--dir')
      expect(optionalCall?.args).toContain('--save-optional')
      expect(optionalCall?.args).toContain('--silent')
    }
  )

  itCleanEnv(
    'prefers the project local extension-develop over the CLI override',
    async () => {
      const overrideDevelopRoot = makeTempDir('extjs-develop-override-')
      const localDevelopRoot = path.join(
        makeTempDir('extjs-project-local-'),
        'node_modules',
        'extension-develop'
      )
      const projectRoot = path.dirname(path.dirname(localDevelopRoot))

      writeJson(path.join(overrideDevelopRoot, 'package.json'), {
        name: 'extension-develop'
      })
      writeJson(path.join(localDevelopRoot, 'package.json'), {
        name: 'extension-develop'
      })
      writeJson(path.join(projectRoot, 'package.json'), {
        name: 'demo',
        dependencies: {react: '^18.0.0'}
      })

      process.env.EXTENSION_CREATE_DEVELOP_ROOT = overrideDevelopRoot
      process.env.npm_config_user_agent = 'npm/9.0.0'
      process.env.EXTENSION_ENV = 'development'

      const cwd = process.cwd()
      process.chdir(projectRoot)

      const mod = await import('../steps/install-internal-deps')
      await mod.installInternalDependencies(projectRoot, console)

      process.chdir(cwd)

      const optionalCall = spawnCalls.find((call) => {
        const args = call.args.join(' ')
        return (
          args.includes('react-refresh') &&
          args.includes('@rspack/plugin-react-refresh')
        )
      })

      expect(optionalCall).toBeTruthy()
      expect(optionalCall?.cwd).toBe(localDevelopRoot)
      expect(optionalCall?.cwd).not.toBe(overrideDevelopRoot)
      expect(optionalCall?.args.join(' ')).not.toContain('--prefix')
      expect(optionalCall?.args.join(' ')).toContain('--legacy-peer-deps')
    }
  )
})
