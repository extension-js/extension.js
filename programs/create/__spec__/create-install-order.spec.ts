import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {stripVTControlCharacters} from 'node:util'
import {sync as spawnSync} from 'cross-spawn'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import type {InstallRunner} from '../lib/install-runner'
import type {VersionProbe} from '../lib/package-manager'
import type {CreateResult} from '../module'
import {type CreateSeams, runCreate} from '../run-create'
import type {DependencyResolver} from '../steps/install-internal-deps'
import {
  buildExamplesArchive,
  fixtureExtensionFiles
} from './examples-catalog-fixture'
import {type LoopbackServer, serveLoopback} from './loopback-template-server'

// The install reads the finished package.json, and everything that makes the
// scaffold the user's own comes after it, the first commit last of all.
const TEMPLATE = 'flow-fixture'
const STUBBED_ENV = [
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_SYSTEM',
  'EXTENSION_ENV',
  'EXTENSION_ALLOW_HTTP_TEMPLATE',
  'EXTENSION_CREATE_TEMPLATE_URL',
  'EXTENSION_CREATE_DEVELOP_ROOT',
  'EXTENSION_SKIP_INTERNAL_INSTALL',
  'npm_config_user_agent',
  'npm_execpath'
]

interface InstallCall {
  command: string
  args: string[]
  cwd: string
  // What the project held at the moment the package manager was started.
  entries: string[]
  packageJson: {
    name?: string
    private?: boolean
    packageManager?: string
    devDependencies: Record<string, string>
    scripts: Record<string, string>
  }
  manifestName: string
  readme: string
}

interface Flow {
  projectPath: string
  result: CreateResult
  installs: InstallCall[]
  probes: Array<{dependency: string; paths: string[]}>
  versionProbes: number
  lines: string[]
}

let workDir = ''
let catalog: LoopbackServer
let installed: Flow
let notInstalled: Flow
const savedEnv = new Map<string, string | undefined>()

function readJson(file: string) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function git(cwd: string, args: string[]): string {
  return String(
    spawnSync('git', args, {cwd, encoding: 'utf8'}).stdout || ''
  ).trim()
}

async function runFlow(name: string, install: boolean): Promise<Flow> {
  const projectPath = path.join(workDir, name)
  const installs: InstallCall[] = []
  const probes: Flow['probes'] = []
  const lines: string[] = []
  let versionProbes = 0

  // Stands in for the package manager: it records what it was started on and
  // leaves behind the one package the next step looks for.
  const runInstall: InstallRunner = async (command, args, opts) => {
    installs.push({
      command,
      args,
      cwd: opts.cwd,
      entries: (await fs.readdir(projectPath)).sort(),
      packageJson: readJson(path.join(projectPath, 'package.json')),
      manifestName: readJson(path.join(projectPath, 'src', 'manifest.json'))
        .name,
      readme: readFileSync(path.join(projectPath, 'README.md'), 'utf8')
    })

    const develop = path.join(projectPath, 'node_modules', 'extension-develop')
    mkdirSync(develop, {recursive: true})
    writeFileSync(
      path.join(develop, 'package.json'),
      JSON.stringify({name: 'extension-develop', version: '0.0.0'})
    )

    return {code: 0, stdout: '', stderr: ''}
  }

  const canResolveDependency: DependencyResolver = (dependency, paths) => {
    probes.push({dependency, paths})

    return false
  }

  const probeVersion: VersionProbe = () => {
    versionProbes += 1

    return {status: 1, stdout: ''}
  }

  const record = (...args: unknown[]) => {
    lines.push(stripVTControlCharacters(args.map(String).join(' ')))
  }

  const seams: CreateSeams = {
    runInstall,
    canResolveDependency,
    probeVersion,
    cwd: workDir
  }

  const result = await runCreate(
    projectPath,
    {
      template: TEMPLATE,
      install,
      cliVersion: '4.1.12',
      logger: {log: record, error: record}
    },
    seams
  )

  return {projectPath, result, installs, probes, versionProbes, lines}
}

beforeAll(async () => {
  for (const name of STUBBED_ENV) savedEnv.set(name, process.env[name])

  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'extjs-create-order-'))
  const gitConfigPath = path.join(workDir, 'gitconfig')
  await fs.writeFile(
    gitConfigPath,
    '[user]\n\tname = Flow Tester\n\temail = flow@example.com\n[init]\n\tdefaultBranch = main\n'
  )

  catalog = await serveLoopback({
    '/catalog.zip': {
      body: buildExamplesArchive({
        [TEMPLATE]: {
          ...fixtureExtensionFiles(TEMPLATE),
          '.gitignore': 'node_modules\ndist\n'
        }
      })
    }
  })

  process.env.GIT_CONFIG_GLOBAL = gitConfigPath
  process.env.GIT_CONFIG_SYSTEM = '/dev/null'
  process.env.EXTENSION_ENV = 'test'
  process.env.EXTENSION_ALLOW_HTTP_TEMPLATE = 'true'
  process.env.EXTENSION_CREATE_TEMPLATE_URL = catalog.url('/catalog.zip')
  process.env.npm_config_user_agent = 'npm/11.11.0 node/v22.12.0 darwin arm64'
  delete process.env.npm_execpath
  delete process.env.EXTENSION_CREATE_DEVELOP_ROOT
  delete process.env.EXTENSION_SKIP_INTERNAL_INSTALL

  installed = await runFlow('with-install', true)
  notInstalled = await runFlow('without-install', false)
}, 60_000)

afterAll(async () => {
  for (const [name, value] of savedEnv) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }

  await catalog.close()
  await fs.rm(workDir, {recursive: true, force: true})
})

describe('create with install starts the package manager on a finished manifest', () => {
  it('runs the project install in the project, with the manager it declared', () => {
    const [project] = installed.installs

    expect(project.command).toBe('npm')
    expect(project.args).toEqual(['install'])
    expect(project.cwd).toBe(installed.projectPath)
    expect(project.packageJson.packageManager).toBe('npm@11.11.0')
    expect(installed.versionProbes).toBe(0)
  })

  it('has already named the package and declared extension as a dependency', () => {
    const [project] = installed.installs

    expect(project.packageJson.name).toBe('with-install')
    expect(project.packageJson.private).toBe(true)
    expect(project.packageJson.devDependencies.extension).toBe('^4.1.12')
    expect(project.packageJson.scripts.dev).toEqual(expect.any(String))
  })

  it('has already recorded where the template came from', () => {
    expect(installed.installs[0].entries).toContain('.extension-create.json')
  })

  it('has not yet made the scaffold the user’s own', () => {
    const [project] = installed.installs

    expect(project.manifestName).toBe(TEMPLATE)
    expect(project.readme).toBe(`# ${TEMPLATE}\n`)
    expect(project.entries).not.toContain('.git')
  })
})

describe('create with install adds the tooling after the project install', () => {
  it('looks for the tooling in what the project install left behind', () => {
    const develop = path.join(
      installed.projectPath,
      'node_modules',
      'extension-develop'
    )

    expect(installed.probes).toEqual([
      {
        dependency: 'typescript',
        paths: [develop, installed.projectPath, workDir]
      }
    ])
  })

  it('installs what is missing there with the same manager, and nothing else', () => {
    expect(
      installed.installs.map(({command, args, cwd}) => ({command, args, cwd}))
    ).toEqual([
      {command: 'npm', args: ['install'], cwd: installed.projectPath},
      {
        command: 'npm',
        args: [
          'install',
          'typescript',
          '--save-optional',
          '--legacy-peer-deps'
        ],
        cwd: path.join(
          installed.projectPath,
          'node_modules',
          'extension-develop'
        )
      }
    ])
  })

  it('says each install before the scaffold is reported ready', () => {
    const at = (text: string) =>
      installed.lines.findIndex((line) => line.includes(text))

    expect(at('Installing the dependencies…')).toBeGreaterThan(-1)
    expect(at('Installing the dependencies…')).toBeLessThan(at('TypeScript'))
    expect(at('TypeScript')).toBeLessThan(at('with-install is ready.'))
  })
})

describe('create with install personalizes and commits after the install', () => {
  it('names the manifest after the project and the manager in the README', () => {
    const manifest = readJson(
      path.join(installed.projectPath, 'src', 'manifest.json')
    )

    expect(manifest.name).toBe('with-install')
    expect(
      readFileSync(path.join(installed.projectPath, 'README.md'), 'utf8')
    ).toContain('npm run dev')
  })

  it('makes one first commit that leaves the installed packages out', () => {
    const tracked = git(installed.projectPath, ['ls-files']).split('\n')

    expect(git(installed.projectPath, ['rev-list', '--count', 'HEAD'])).toBe(
      '1'
    )

    expect(git(installed.projectPath, ['log', '--format=%s'])).toBe(
      `Create with-install from the ${TEMPLATE} template`
    )

    expect(tracked).toContain('package.json')
    expect(tracked).toContain('.extension-create.json')
    expect(tracked.filter((file) => file.startsWith('node_modules'))).toEqual(
      []
    )

    expect(git(installed.projectPath, ['status', '--porcelain'])).toBe('')
  })

  it('answers that the dependencies are installed and how long it took', () => {
    expect(installed.result).toEqual({
      projectPath: installed.projectPath,
      projectName: 'with-install',
      packageName: 'with-install',
      template: TEMPLATE,
      depsInstalled: true,
      installSeconds: expect.any(Number),
      packageManager: 'npm',
      packageManagerSpec: 'npm@11.11.0',
      templateProvenance: {
        template: TEMPLATE,
        source: catalog.url('/catalog.zip')
      }
    })

    expect(
      readJson(path.join(installed.projectPath, '.extension-create.json'))
    ).toMatchObject(installed.result.templateProvenance)
  })

  it('prints next steps that skip the install', () => {
    const ready = installed.lines.find((line) => line.includes('is ready.'))

    expect(ready).toContain('npm run dev')
    expect(ready).not.toContain('npm install')
  })
})

describe('create without install starts no package manager', () => {
  it('runs no install and looks for no tooling', () => {
    expect(notInstalled.installs).toEqual([])
    expect(notInstalled.probes).toEqual([])
    expect(
      existsSync(path.join(notInstalled.projectPath, 'node_modules'))
    ).toBe(false)

    expect(
      notInstalled.lines.filter((line) => line.includes('Installing'))
    ).toEqual([])
  })

  it('answers that nothing is installed and reports no install time', () => {
    expect(notInstalled.result).toEqual({
      projectPath: notInstalled.projectPath,
      projectName: 'without-install',
      packageName: 'without-install',
      template: TEMPLATE,
      depsInstalled: false,
      packageManager: 'npm',
      packageManagerSpec: 'npm@11.11.0',
      templateProvenance: {
        template: TEMPLATE,
        source: catalog.url('/catalog.zip')
      }
    })

    expect(notInstalled.result).not.toHaveProperty('installSeconds')
  })

  it('prints the install as the next step and still commits the scaffold', () => {
    const ready = notInstalled.lines.find((line) => line.includes('is ready.'))

    expect(ready).toContain('npm install')
    expect(ready).toContain('npm run dev')
    expect(git(notInstalled.projectPath, ['rev-list', '--count', 'HEAD'])).toBe(
      '1'
    )
  })
})

describe('create refuses a name it cannot use before anything else happens', () => {
  it.each([
    ['no name at all', undefined, 'A project name is required.'],
    [
      'a URL',
      'https://example.com/my-extension',
      'A URL is not a valid project path.'
    ]
  ])('for %s', async (_label, name, refusal) => {
    const lines: string[] = []

    const record = (...args: unknown[]) => {
      lines.push(args.map(String).join(' '))
    }

    const error = (await runCreate(name, {
      install: true,
      logger: {log: record, error: record}
    }).catch((thrown: Error) => thrown)) as Error

    expect(stripVTControlCharacters(error.message)).toContain(refusal)
    expect(lines).toEqual([])
    expect(existsSync(path.join(process.cwd(), 'https:'))).toBe(false)
  })
})
