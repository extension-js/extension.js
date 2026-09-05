import {existsSync} from 'node:fs'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {sync as spawnSync} from 'cross-spawn'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

// Scaffolding into a directory that is already someone's repository keeps
// what is theirs: the ignore rules they wrote, the paths they ignore, and a
// branch with history that gets no commit they did not ask for. An empty
// folder and a bare repository with a licence scaffold as they always did.
const savedEnv = {
  GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
  GIT_CONFIG_SYSTEM: process.env.GIT_CONFIG_SYSTEM,
  EXTENSION_ENV: process.env.EXTENSION_ENV
}

let root = ''
const logs: string[] = []
const logger = {
  log: (...a: unknown[]) => logs.push(a.map(String).join(' ')),
  error: (...a: unknown[]) => logs.push(a.map(String).join(' '))
}

function git(cwd: string, args: string[]): string {
  return String(
    spawnSync('git', args, {cwd, encoding: 'utf8'}).stdout || ''
  ).trim()
}

async function runCreate(dir: string) {
  const {extensionCreate} = await import('../module')
  try {
    await extensionCreate(dir, {
      template: 'javascript',
      install: false,
      cliVersion: '4.1.12',
      logger
    } as any)
    return {ok: true, error: ''}
  } catch (err) {
    return {ok: false, error: String(err)}
  }
}

const R: Record<string, string> = {}

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'extjs-create-existing-'))
  const configPath = path.join(root, 'gitconfig')
  await fs.writeFile(
    configPath,
    '[user]\n\tname = Existing Owner\n\temail = owner@example.com\n[init]\n\tdefaultBranch = main\n'
  )
  process.env.GIT_CONFIG_GLOBAL = configPath
  process.env.GIT_CONFIG_SYSTEM = '/dev/null'
  process.env.EXTENSION_ENV = 'test'

  const adopted = path.join(root, 'adopted')
  await fs.mkdir(path.join(adopted, '.idea'), {recursive: true})
  await fs.mkdir(path.join(adopted, '.github', 'workflows'), {recursive: true})
  git(adopted, ['init', '--quiet'])
  await fs.writeFile(
    path.join(adopted, '.gitignore'),
    '# my rules\n.idea/\n.env.local\n'
  )
  await fs.writeFile(path.join(adopted, '.idea', 'workspace.xml'), '<p/>\n')
  await fs.writeFile(path.join(adopted, '.env.local'), 'SECRET=1\n')
  await fs.writeFile(
    path.join(adopted, '.github', 'workflows', 'ci.yml'),
    'name: ci\n'
  )
  await fs.writeFile(path.join(adopted, 'LICENSE'), 'MIT\n')
  git(adopted, ['add', '--all'])
  git(adopted, [
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--quiet',
    '--no-verify',
    '--message',
    'my own first commit'
  ])
  R.adopted = adopted

  const empty = path.join(root, 'empty')
  await fs.mkdir(empty, {recursive: true})
  R.empty = empty

  const bare = path.join(root, 'bare-repo')
  await fs.mkdir(bare, {recursive: true})
  git(bare, ['init', '--quiet'])
  await fs.writeFile(path.join(bare, 'LICENSE'), 'MIT\n')
  R.bare = bare

  for (const dir of [adopted, empty, bare]) {
    const result = await runCreate(dir)
    expect(result, dir).toEqual({ok: true, error: ''})
  }
}, 300_000)

afterAll(async () => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  await fs.rm(root, {recursive: true, force: true})
})

describe('create into a directory that is already a repository', () => {
  it('accounts for the hidden files it keeps', () => {
    expect(logs.join('\n')).toMatch(/\.gitignore/)
  })

  it('keeps the rules the owner wrote and adds the template rules', async () => {
    const contents = await fs.readFile(
      path.join(R.adopted, '.gitignore'),
      'utf8'
    )
    expect(contents).toContain('# my rules')
    expect(contents).toContain('.idea/')
    expect(contents).toContain('node_modules')
  })

  it('leaves ignored paths out of the index and adds no commit to existing history', () => {
    expect(git(R.adopted, ['ls-files'])).not.toMatch(/\.idea\//)
    expect(git(R.adopted, ['rev-list', '--count', 'HEAD'])).toBe('1')
    expect(existsSync(path.join(R.adopted, 'src', 'manifest.json'))).toBe(true)
  })

  it('still scaffolds and commits an empty folder and a bare repository with a licence', () => {
    expect(existsSync(path.join(R.empty, 'src', 'manifest.json'))).toBe(true)
    expect(git(R.empty, ['rev-list', '--count', 'HEAD'])).toBe('1')
    expect(existsSync(path.join(R.bare, 'src', 'manifest.json'))).toBe(true)
    expect(git(R.bare, ['rev-list', '--count', 'HEAD'])).toBe('1')
  })
})
