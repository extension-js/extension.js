import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {
  resolvePackageManagerSpec,
  resolveProjectPackageManager
} from '../lib/package-manager'
import {overridePackageJson} from '../steps/write-package-json'

// A project has one package manager. The starter's pin (or the pnpm
// workspace file it ships) decides it; an unpinned starter records the
// manager that ran the scaffold; a host with no user agent still declares
// a usable one.
const dirs: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  for (const dir of dirs.splice(0)) {
    await fs.rm(dir, {recursive: true, force: true})
  }
})

async function project(
  packageJson: Record<string, unknown>,
  extra: string[] = []
) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'extjs-pm-identity-'))
  dirs.push(dir)
  await fs.writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify(packageJson)
  )
  for (const file of extra) await fs.writeFile(path.join(dir, file), '')
  return dir
}

const npmUserAgent = 'npm/11.11.0 node/v22.0.0 darwin arm64'

describe('one package-manager identity per scaffold', () => {
  it('lets a pinned starter decide the manager under a different invoker', async () => {
    vi.stubEnv('npm_config_user_agent', npmUserAgent)
    const dir = await project({name: 'seed', packageManager: 'pnpm@8.15.0'})
    expect(resolveProjectPackageManager(dir)).toBe('pnpm')
    expect(resolvePackageManagerSpec(dir, 'pnpm')).toBe('pnpm@8.15.0')
  })

  it('reads a shipped pnpm workspace file as a pnpm layout', async () => {
    vi.stubEnv('npm_config_user_agent', npmUserAgent)
    const dir = await project({name: 'seed'}, ['pnpm-workspace.yaml'])
    expect(resolveProjectPackageManager(dir)).toBe('pnpm')
  })

  it('records the invoking manager for an unpinned starter', async () => {
    vi.stubEnv('npm_config_user_agent', npmUserAgent)
    const dir = await project({name: 'seed'})
    expect(resolveProjectPackageManager(dir)).toBe('npm')
    expect(resolvePackageManagerSpec(dir, 'npm')).toBe('npm@11.11.0')
  })

  it('still declares a usable manager when the environment names none', async () => {
    vi.stubEnv('npm_config_user_agent', '')
    vi.stubEnv('npm_execpath', '')
    const dir = await project({name: 'seed'})
    expect(resolveProjectPackageManager(dir)).toBe('npm')
    expect(resolvePackageManagerSpec(dir, 'npm')).toMatch(/^npm@\d+\.\d+\.\d+/)
  })

  it('declares, and keeps the pnpm block for, the manager the project uses', async () => {
    vi.stubEnv('npm_config_user_agent', npmUserAgent)
    const dir = await project({
      name: 'seed',
      private: true,
      packageManager: 'pnpm@8.15.0',
      dependencies: {less: '4.0.0'}
    })
    const manager = resolveProjectPackageManager(dir)
    await overridePackageJson(
      dir,
      {cliVersion: '4.1.12', packageManager: manager},
      console
    )
    const pkg = JSON.parse(
      await fs.readFile(path.join(dir, 'package.json'), 'utf8')
    )
    expect(pkg.packageManager).toBe('pnpm@8.15.0')
    expect(pkg.pnpm.ignoredBuiltDependencies).toContain('less')

    const plain = await project({name: 'seed', private: true})
    await overridePackageJson(
      plain,
      {
        cliVersion: '4.1.12',
        packageManager: resolveProjectPackageManager(plain)
      },
      console
    )
    const plainPkg = JSON.parse(
      await fs.readFile(path.join(plain, 'package.json'), 'utf8')
    )
    expect(plainPkg.packageManager).toBe('npm@11.11.0')
    expect(plainPkg.pnpm).toBeUndefined()
  })
})
