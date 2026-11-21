import {existsSync, readFileSync} from 'node:fs'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {stripVTControlCharacters} from 'node:util'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {type CreateSeams, runCreate} from '../run-create'
import {
  fixtureExtensionFiles,
  serveExamplesCatalog
} from './examples-catalog-fixture'
import {fakeSpawn} from './fake-spawn'

// The rows never read the repository, so git answers at once: real git has
// taken past 5 s on a Windows runner.
const quickSeams: CreateSeams = {
  git: {spawn: fakeSpawn(() => ({exit: 0})).spawn}
}

// Each row still copies a whole template and writes every file into a real
// folder, which a Windows runner has taken seconds to do, as in the siblings.
const TEMPLATE_COPY_MS = 60_000

// The folder keeps the name the user typed. package.json gets a name npm
// takes, said once, or create stops before it writes anything.
const savedEnv = {
  GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
  GIT_CONFIG_SYSTEM: process.env.GIT_CONFIG_SYSTEM,
  EXTENSION_ENV: process.env.EXTENSION_ENV
}

let root = ''

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'extjs-create-pkg-name-'))
  const configPath = path.join(root, 'gitconfig')
  await fs.writeFile(
    configPath,
    '[user]\n\tname = Name Spec\n\temail = name@example.com\n[init]\n\tdefaultBranch = main\n'
  )

  process.env.GIT_CONFIG_GLOBAL = configPath
  process.env.GIT_CONFIG_SYSTEM = '/dev/null'
  process.env.EXTENSION_ENV = 'test'
})

afterAll(async () => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }

  await fs.rm(root, {recursive: true, force: true})
})

function recorder() {
  const lines: string[] = []

  const record = (...args: unknown[]) => {
    lines.push(stripVTControlCharacters(args.map(String).join(' ')))
  }

  return {lines, logger: {log: record, error: record}}
}

function packageName(projectPath: string) {
  return JSON.parse(
    readFileSync(path.join(projectPath, 'package.json'), 'utf8')
  ).name
}

// The manifest keeps the folder name, at the root or under src.
function manifestName(projectPath: string) {
  const root = path.join(projectPath, 'manifest.json')
  const file = existsSync(root)
    ? root
    : path.join(projectPath, 'src', 'manifest.json')

  return JSON.parse(readFileSync(file, 'utf8')).name
}

describe('create names the package npm takes and keeps the folder', () => {
  it(
    'derives one from the bundled template and says so',
    async () => {
      const {lines, logger} = recorder()
      const projectPath = path.join(root, 'bad name!')

      const result = await runCreate(
        projectPath,
        {
          template: 'javascript',
          logger
        },
        quickSeams
      )

      expect(existsSync(projectPath)).toBe(true)
      expect(packageName(projectPath)).toBe('bad-name')
      expect(result).toMatchObject({
        projectName: 'bad name!',
        packageName: 'bad-name'
      })

      expect(lines.join('\n')).toContain(
        'package.json names it bad-name, because npm refuses "bad name!" as a package name. Change it in package.json if you like.'
      )
    },
    TEMPLATE_COPY_MS
  )

  it(
    'writes the folder name as it is when npm takes it, with no note',
    async () => {
      const {lines, logger} = recorder()
      const projectPath = path.join(root, 'fine-name')

      const result = await runCreate(
        projectPath,
        {
          template: 'javascript',
          logger
        },
        quickSeams
      )

      expect(packageName(projectPath)).toBe('fine-name')
      expect(result.packageName).toBe('fine-name')
      expect(lines.join('\n')).not.toContain('package.json names it')
    },
    TEMPLATE_COPY_MS
  )

  it(
    'derives the same name over a catalog template that ships its own',
    async () => {
      const catalog = await serveExamplesCatalog({
        'ships-name': fixtureExtensionFiles('ships-name')
      })

      try {
        process.env.EXTENSION_CREATE_TEMPLATE_URL = catalog.url
        process.env.EXTENSION_ALLOW_HTTP_TEMPLATE = 'true'
        const projectPath = path.join(root, 'My Catalog Pick')

        await runCreate(
          projectPath,
          {
            template: 'ships-name',
            logger: recorder().logger
          },
          quickSeams
        )

        expect(packageName(projectPath)).toBe('my-catalog-pick')
      } finally {
        delete process.env.EXTENSION_CREATE_TEMPLATE_URL
        delete process.env.EXTENSION_ALLOW_HTTP_TEMPLATE
        await catalog.close()
      }
    },
    TEMPLATE_COPY_MS
  )

  // The folder is theirs in any language. Nothing typed is lost, so the
  // package gets the plain fallback rather than a remainder.
  it.each(['café', '日本'])(
    'creates %j with the fallback package name and says so',
    async (folder) => {
      const {lines, logger} = recorder()
      const projectPath = path.join(root, folder)

      const result = await runCreate(
        projectPath,
        {
          template: 'javascript',
          logger
        },
        quickSeams
      )

      expect(packageName(projectPath)).toBe('my-extension')
      expect(result).toMatchObject({
        projectName: folder,
        packageName: 'my-extension'
      })

      expect(manifestName(projectPath)).toBe(folder)
      expect(lines.join('\n')).toContain(
        `package.json names it my-extension, because npm refuses "${folder}" as a package name. Change it in package.json if you like.`
      )
    },
    TEMPLATE_COPY_MS
  )

  it.each([
    'node_modules',
    'favicon.ico'
  ])('refuses the folder %j before it writes anything', async (folder) => {
    const {lines, logger} = recorder()
    const projectPath = path.join(root, folder)

    const error = (await runCreate(
      projectPath,
      {
        template: 'javascript',
        logger
      },
      quickSeams
    ).catch((thrown: unknown) => thrown)) as Error & {code?: string}

    expect(error).toBeInstanceOf(Error)
    expect(error.code).toBe('E_ARGS')
    expect(stripVTControlCharacters(error.message)).toContain(
      `"${folder}" can't be the project folder name: npm and the tools around it treat a folder of that name as their own.`
    )

    expect(lines).toEqual([])
    expect(existsSync(projectPath)).toBe(false)
  })
})
