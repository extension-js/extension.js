import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {scaffoldReady} from '../lib/messages'
import {
  declarePackageManager,
  resolveProjectPackageManager,
  type ScaffoldPackageManager,
  type VersionProbe
} from '../lib/package-manager'
import {overridePackageJson} from '../steps/write-package-json'
import {writeReadmeFile} from '../steps/write-readme-file'

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
const noopLogger = {log() {}, error() {}}

// The pin or the invoker answers in these tests, so the binary is never asked.
const noProbe: VersionProbe = () => {
  throw new Error('the version probe ran')
}

const pinnedStarters: Array<[string, ScaffoldPackageManager]> = [
  ['pnpm@8.15.0', 'pnpm'],
  ['bun@1.1.0', 'bun']
]

async function pinnedProject(pin: string) {
  const dir = await project({name: 'seed', packageManager: pin})

  await fs.writeFile(
    path.join(dir, 'manifest.json'),
    JSON.stringify({manifest_version: 3, name: 'seed'})
  )

  return dir
}

describe('one package-manager identity per scaffold', () => {
  it('lets a pinned starter decide the manager under a different invoker', async () => {
    vi.stubEnv('npm_config_user_agent', npmUserAgent)
    const dir = await project({name: 'seed', packageManager: 'pnpm@8.15.0'})
    expect(resolveProjectPackageManager(dir)).toBe('pnpm')
    expect((await declarePackageManager(dir, 'pnpm', noProbe)).spec).toBe(
      'pnpm@8.15.0'
    )
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
    expect((await declarePackageManager(dir, 'npm', noProbe)).spec).toBe(
      'npm@11.11.0'
    )
  })

  it('still declares a usable manager when the environment names none', async () => {
    vi.stubEnv('npm_config_user_agent', '')
    vi.stubEnv('npm_execpath', '')
    const dir = await project({name: 'seed'})
    expect(resolveProjectPackageManager(dir)).toBe('npm')

    // The installed binary is the one source left. A stand-in answers for
    // it, so a slow real npm on a loaded runner cannot fail this test.
    const asked: string[] = []

    const installed: VersionProbe = (command, args) => {
      asked.push([command, ...args].join(' '))

      return {status: 0, stdout: '10.9.2\n'}
    }

    expect(await declarePackageManager(dir, 'npm', installed)).toEqual({
      spec: 'npm@10.9.2'
    })

    expect(asked).toEqual(['npm --version'])
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

// One create must not produce three answers. The README is the file the user
// keeps, so it names the same manager as the next steps and package.json.
describe.each(
  pinnedStarters
)('a %s starter names one manager everywhere', (pin, manager) => {
  it('agrees across the README, the next steps and package.json', async () => {
    // A different invoker on purpose: the pin decides, not the environment.
    vi.stubEnv('npm_config_user_agent', npmUserAgent)
    const dir = await pinnedProject(pin)

    expect(resolveProjectPackageManager(dir)).toBe(manager)

    await writeReadmeFile(dir, 'seed', noopLogger)
    const readme = await fs.readFile(path.join(dir, 'README.md'), 'utf8')
    expect(readme).toContain(`${manager} run dev`)
    expect(readme).toContain(`${manager} run build:firefox`)

    await overridePackageJson(
      dir,
      {cliVersion: '4.1.12', packageManager: manager},
      noopLogger
    )

    const pkg = JSON.parse(
      await fs.readFile(path.join(dir, 'package.json'), 'utf8')
    )
    expect(pkg.packageManager).toBe(pin)

    const steps = await scaffoldReady(dir, 'seed', false, manager)
    expect(steps).toContain(`${manager} dev`)
  })
})

describe('no scaffold step derives a package manager of its own', () => {
  it('leaves detectPackageManagerFromEnv to the project resolver', async () => {
    const stepsDir = path.resolve(__dirname, '..', 'steps')
    const entries = await fs.readdir(stepsDir, {withFileTypes: true})
    const offenders: string[] = []

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.ts')) continue

      const source = await fs.readFile(path.join(stepsDir, entry.name), 'utf8')

      if (source.includes('detectPackageManagerFromEnv')) {
        offenders.push(entry.name)
      }
    }

    expect(offenders).toEqual([])
  })
})
