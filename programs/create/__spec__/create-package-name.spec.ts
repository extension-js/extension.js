import {existsSync, readFileSync} from 'node:fs'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {stripVTControlCharacters} from 'node:util'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {runCreate} from '../run-create'
import {
  fixtureExtensionFiles,
  serveExamplesCatalog
} from './examples-catalog-fixture'

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

describe('create names the package npm takes and keeps the folder', () => {
  it('derives one from the bundled template and says so', async () => {
    const {lines, logger} = recorder()
    const projectPath = path.join(root, 'bad name!')

    const result = await runCreate(projectPath, {
      template: 'javascript',
      logger
    })

    expect(existsSync(projectPath)).toBe(true)
    expect(packageName(projectPath)).toBe('bad-name')
    expect(result).toMatchObject({
      projectName: 'bad name!',
      packageName: 'bad-name'
    })

    expect(lines.join('\n')).toContain(
      'package.json names it bad-name, because npm refuses "bad name!" as a package name.'
    )
  })

  it('writes the folder name as it is when npm takes it, with no note', async () => {
    const {lines, logger} = recorder()
    const projectPath = path.join(root, 'fine-name')

    const result = await runCreate(projectPath, {
      template: 'javascript',
      logger
    })

    expect(packageName(projectPath)).toBe('fine-name')
    expect(result.packageName).toBe('fine-name')
    expect(lines.join('\n')).not.toContain('package.json names it')
  })

  it('derives the same name over a catalog template that ships its own', async () => {
    const catalog = await serveExamplesCatalog({
      'ships-name': fixtureExtensionFiles('ships-name')
    })

    try {
      process.env.EXTENSION_CREATE_TEMPLATE_URL = catalog.url
      process.env.EXTENSION_ALLOW_HTTP_TEMPLATE = 'true'
      const projectPath = path.join(root, 'My Catalog Pick')

      await runCreate(projectPath, {
        template: 'ships-name',
        logger: recorder().logger
      })

      expect(packageName(projectPath)).toBe('my-catalog-pick')
    } finally {
      delete process.env.EXTENSION_CREATE_TEMPLATE_URL
      delete process.env.EXTENSION_ALLOW_HTTP_TEMPLATE
      await catalog.close()
    }
  })

  it.each([
    ['café', 'it has characters npm does not allow'],
    ['node_modules', 'npm reserves that name']
  ])('refuses %j before it writes anything', async (folder, problem) => {
    const {lines, logger} = recorder()
    const projectPath = path.join(root, folder)

    const error = (await runCreate(projectPath, {
      template: 'javascript',
      logger
    }).catch((thrown: unknown) => thrown)) as Error & {code?: string}

    expect(error).toBeInstanceOf(Error)
    expect(error.code).toBe('E_ARGS')
    expect(stripVTControlCharacters(error.message)).toContain(
      `"${folder}" can't be a package name: ${problem}.`
    )

    expect(lines).toEqual([])
    expect(existsSync(projectPath)).toBe(false)
  })
})
