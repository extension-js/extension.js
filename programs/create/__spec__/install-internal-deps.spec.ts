import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import os from 'os'

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

  beforeEach(() => {
    vi.resetModules()
    process.env = {...originalEnv}
    spawnCalls.length = 0
  })

  afterEach(() => {
    for (const d of created) {
      try {
        fs.rmSync(d, {recursive: true, force: true})
      } catch {}
    }
    created.length = 0
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  it('installs missing build and optional deps into develop root', async () => {
    const developRoot = makeTempDir('extjs-develop-')
    const projectRoot = makeTempDir('extjs-project-')

    writeJson(path.join(developRoot, 'package.json'), {
      name: 'extension-develop'
    })
    writeJson(
      path.join(
        developRoot,
        'webpack',
        'webpack-lib',
        'build-dependencies.json'
      ),
      {foo: '1.0.0', bar: '2.0.0'}
    )

    fs.mkdirSync(path.join(developRoot, 'node_modules', 'foo'), {
      recursive: true
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
    await mod.installInternalDependencies(projectRoot)

    process.chdir(cwd)

    expect(spawnCalls.length).toBe(2)

    const buildCall = spawnCalls[0]
    expect(buildCall.cwd).toBe(developRoot)
    expect(buildCall.args.join(' ')).toContain('install')
    expect(buildCall.args.join(' ')).toContain('bar@2.0.0')

    const optionalCall = spawnCalls[1]
    expect(optionalCall.cwd).toBe(developRoot)
    const optionalArgs = optionalCall.args.join(' ')
    expect(optionalArgs).toContain('react-refresh')
    expect(optionalArgs).toContain('@rspack/plugin-react-refresh')
    expect(optionalArgs).toContain('postcss')
    expect(optionalArgs).toContain('postcss-loader')
  })
})
