import {readFileSync} from 'node:fs'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {stripVTControlCharacters} from 'node:util'
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest'
import type {InstallRunner} from '../lib/install-runner'
import type {ScaffoldPackageManager} from '../lib/package-manager'
import {runCreate} from '../run-create'
import {
  buildExamplesArchive,
  fixtureExtensionFiles
} from './examples-catalog-fixture'
import {fakeSpawn} from './fake-spawn'
import {type LoopbackServer, serveLoopback} from './loopback-template-server'

// One create gives one answer: the manager it installs with is the one it
// declares, prints in the next steps, writes in the README and hands back.
const pinnedFixture = JSON.parse(
  fixtureExtensionFiles('pinned')['package.json']
)

let workDir = ''
let catalog: LoopbackServer

beforeAll(async () => {
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'extjs-create-manager-'))
  catalog = await serveLoopback({
    '/catalog.zip': {
      body: buildExamplesArchive({
        plain: fixtureExtensionFiles('plain'),
        pinned: {
          ...fixtureExtensionFiles('pinned'),
          'package.json': JSON.stringify({
            ...pinnedFixture,
            packageManager: 'pnpm@8.15.0'
          })
        }
      })
    }
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

afterAll(async () => {
  await catalog.close()
  await fs.rm(workDir, {recursive: true, force: true})
})

async function createAs(
  name: string,
  userAgent: string,
  options: {template?: string; install?: boolean} = {}
) {
  vi.stubEnv('EXTENSION_ENV', 'test')
  vi.stubEnv('EXTENSION_ALLOW_HTTP_TEMPLATE', 'true')
  vi.stubEnv('EXTENSION_CREATE_TEMPLATE_URL', catalog.url('/catalog.zip'))
  vi.stubEnv('EXTENSION_SKIP_INTERNAL_INSTALL', 'true')
  vi.stubEnv('npm_config_user_agent', userAgent)
  vi.stubEnv('npm_execpath', '')

  const projectPath = path.join(workDir, name)
  const installs: Array<{command: string; args: string[]}> = []
  const lines: string[] = []

  const runInstall: InstallRunner = async (command, args) => {
    installs.push({command, args})

    return {code: 0, stdout: '', stderr: ''}
  }

  const record = (...args: unknown[]) => {
    lines.push(stripVTControlCharacters(args.map(String).join(' ')))
  }

  const result = await runCreate(
    projectPath,
    {
      template: options.template ?? 'plain',
      install: options.install ?? true,
      cliVersion: '4.1.12',
      logger: {log: record, error: record}
    },
    {
      runInstall,
      probeVersion: () => ({status: 1, stdout: ''}),
      // Every git call answers yes, so the step reads the folder as a
      // repository with history and commits nothing.
      git: {spawn: fakeSpawn(() => ({exit: 0})).spawn}
    }
  )

  return {
    result,
    installs,
    ready: lines.find((line) => line.includes('is ready.')) ?? '',
    packageJson: JSON.parse(
      readFileSync(path.join(projectPath, 'package.json'), 'utf8')
    ),
    readme: readFileSync(path.join(projectPath, 'README.md'), 'utf8')
  }
}

const invokers: Array<[ScaffoldPackageManager, string, string, string]> = [
  ['npm', 'npm/11.11.0 node/v22.12.0 darwin arm64', '11.11.0', 'npm run dev'],
  ['pnpm', 'pnpm/9.9.0 npm/? node/v22.12.0 darwin arm64', '9.9.0', 'pnpm dev'],
  ['yarn', 'yarn/4.5.0 npm/? node/v22.12.0 darwin arm64', '4.5.0', 'yarn dev'],
  ['bun', 'bun/1.1.0 npm/? node/v22.12.0 darwin arm64', '1.1.0', 'bun dev']
]

describe.each(
  invokers
)('a create started by %s', (manager, userAgent, version, devCommand) => {
  it('installs with it, declares it, prints it and hands it back', async () => {
    const created = await createAs(`by-${manager}`, userAgent)

    expect(created.installs).toEqual([{command: manager, args: ['install']}])
    expect(created.result.packageManager).toBe(manager)
    expect(created.result.depsInstalled).toBe(true)
    expect(created.packageJson.packageManager).toBe(`${manager}@${version}`)
    expect(created.readme).toContain(`${manager} run dev`)
    expect(created.ready).toContain(devCommand)
    expect(created.ready).not.toContain(`${manager} install`)
  })
})

describe('a create that does not install', () => {
  it('hands back the invoking manager and prints its install as a next step', async () => {
    const created = await createAs(
      'bun-no-install',
      'bun/1.1.0 npm/? node/v22.12.0 darwin arm64',
      {install: false}
    )

    expect(created.installs).toEqual([])
    expect(created.result.packageManager).toBe('bun')
    expect(created.result.depsInstalled).toBe(false)
    expect(created.packageJson.packageManager).toBe('bun@1.1.0')
    expect(created.ready).toContain('bun install')
    expect(created.ready).toContain('bun dev')
  })
})

describe('a create from a starter that pins its manager', () => {
  it('installs with the pin and hands it back, whoever started the create', async () => {
    const created = await createAs(
      'pinned-pnpm',
      'npm/11.11.0 node/v22.12.0 darwin arm64',
      {template: 'pinned'}
    )

    expect(created.installs).toEqual([{command: 'pnpm', args: ['install']}])
    expect(created.result.packageManager).toBe('pnpm')
    expect(created.packageJson.packageManager).toBe('pnpm@8.15.0')
    expect(created.readme).toContain('pnpm run dev')
    expect(created.ready).toContain('pnpm dev')
    expect(created.ready).not.toContain('npm run dev')
  })
})
