import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {scaffoldReady} from '../lib/messages'
import {
  resolveProjectPackageManager,
  type ScaffoldPackageManager
} from '../lib/package-manager'
import {overridePackageJson} from '../steps/write-package-json'
import {writeReadmeFile} from '../steps/write-readme-file'

// One create must not produce three answers. The README is the file the user
// keeps, so it names the same manager as the next steps and package.json.
const dirs: string[] = []
const npmUserAgent = 'npm/11.11.0 node/v22.0.0 darwin arm64'
const noopLogger = {log() {}, error() {}}

const pinnedStarters: Array<[string, ScaffoldPackageManager]> = [
  ['pnpm@8.15.0', 'pnpm'],
  ['bun@1.1.0', 'bun']
]

afterEach(async () => {
  vi.unstubAllEnvs()

  for (const dir of dirs.splice(0)) {
    await fs.rm(dir, {recursive: true, force: true})
  }
})

async function pinnedProject(pin: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'extjs-pm-readme-'))
  dirs.push(dir)
  await fs.writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({name: 'seed', packageManager: pin})
  )

  await fs.writeFile(
    path.join(dir, 'manifest.json'),
    JSON.stringify({manifest_version: 3, name: 'seed'})
  )

  return dir
}

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
