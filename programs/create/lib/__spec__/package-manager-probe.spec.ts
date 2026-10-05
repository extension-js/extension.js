import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const spawnSyncMock = vi.hoisted(() => vi.fn())
vi.mock('cross-spawn', () => ({
  sync: (...args: unknown[]) => spawnSyncMock(...args)
}))

import {resolvePackageManagerSpec} from '../package-manager'

const REGISTRY_NAMES = ['npm_config_registry', 'corepack_npm_registry']
const tmpRoots: string[] = []
let saved: Record<string, string | undefined> = {}

beforeEach(() => {
  spawnSyncMock.mockReset()
  spawnSyncMock.mockImplementation(() => ({status: 0, stdout: '9.9.9\n'}))
  vi.stubEnv('npm_config_user_agent', '')
  saved = {}

  for (const key of Object.keys(process.env)) {
    if (REGISTRY_NAMES.includes(key.toLowerCase())) {
      saved[key] = process.env[key]
      delete process.env[key]
    }
  }
})

afterEach(() => {
  vi.unstubAllEnvs()

  for (const key of Object.keys(process.env)) {
    if (REGISTRY_NAMES.includes(key.toLowerCase())) delete process.env[key]
  }

  Object.assign(process.env, saved)

  for (const dir of tmpRoots.splice(0)) {
    fs.rmSync(dir, {recursive: true, force: true})
  }
})

function unpinnedProject(npmrc: string | null): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-corepack-probe-'))
  tmpRoots.push(dir)
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"unpinned"}\n')

  if (npmrc !== null) fs.writeFileSync(path.join(dir, '.npmrc'), npmrc)

  return dir
}

describe('the package manager version probe', () => {
  it('points Corepack at the registry the project .npmrc pins', () => {
    const dir = unpinnedProject('registry=http://127.0.0.1:4882/\n')

    expect(resolvePackageManagerSpec(dir, 'pnpm')).toBe('pnpm@9.9.9')
    expect(spawnSyncMock).toHaveBeenCalledTimes(1)

    const [command, args, options] = spawnSyncMock.mock.calls[0]
    expect(command).toBe('pnpm')
    expect(args).toEqual(['--version'])
    expect(options.env.COREPACK_NPM_REGISTRY).toBe('http://127.0.0.1:4882')
    expect(options.env.PATH).toBe(process.env.PATH)
  })

  it('sets no Corepack registry for a project that pins none', () => {
    expect(resolvePackageManagerSpec(unpinnedProject(null), 'pnpm')).toBe(
      'pnpm@9.9.9'
    )

    const [, , options] = spawnSyncMock.mock.calls[0]
    expect(options.env).not.toHaveProperty('COREPACK_NPM_REGISTRY')
  })
})
