import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {sync as spawnSync} from 'cross-spawn'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {extensionCreate} from '../module'

const IDENTITY_NAME = 'Scaffold Tester'
const IDENTITY_EMAIL = 'scaffold@example.com'

let workDir: string
let projectPath: string
let logLines: string[] = []

const logger = {
  log: (...args: unknown[]) => {
    logLines.push(args.map((arg) => String(arg)).join(' '))
  },
  error: (...args: unknown[]) => {
    logLines.push(args.map((arg) => String(arg)).join(' '))
  }
}

function readProjectFile(...segments: string[]) {
  return fs.readFile(path.join(projectPath, ...segments), 'utf8')
}

async function readJson(...segments: string[]) {
  return JSON.parse(await readProjectFile(...segments))
}

function git(args: string[]) {
  const result = spawnSync('git', args, {
    cwd: projectPath,
    encoding: 'utf8'
  })
  return String(result.stdout || '').trim()
}

beforeAll(async () => {
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'extjs-create-identity-'))
  const gitConfigPath = path.join(workDir, 'gitconfig')
  await fs.writeFile(
    gitConfigPath,
    `[user]\n\tname = ${IDENTITY_NAME}\n\temail = ${IDENTITY_EMAIL}\n[init]\n\tdefaultBranch = main\n`
  )
  process.env.GIT_CONFIG_GLOBAL = gitConfigPath
  process.env.GIT_CONFIG_SYSTEM = '/dev/null'
  delete process.env.npm_config_user_agent
  delete process.env.npm_execpath
  process.env.BUN_INSTALL = path.join(workDir, '.bun')

  projectPath = path.join(workDir, 'my-extension')
  logLines = []
  await extensionCreate(projectPath, {
    install: false,
    cliVersion: '4.0.23',
    template: 'javascript',
    logger
  })
}, 60000)

afterAll(async () => {
  await fs.rm(workDir, {recursive: true, force: true})
})

describe('the javascript scaffold names itself', () => {
  it('names the template on the card', () => {
    const cardLine = logLines
      .join('\n')
      .split('\n')
      .find((line) => line.includes('Template'))
    expect(cardLine).toBeDefined()
    expect(cardLine).toContain('javascript')
  })

  it('says where the template came from', () => {
    expect(logLines.join('\n')).toContain(
      'Using the javascript template, bundled with this CLI.'
    )
  })

  it('records the same template it printed', async () => {
    const provenance = await readJson('.extension-create.json')
    expect(provenance.template).toBe('javascript')
    expect(provenance.source).toBe('bundled')
  })
})

describe('the scaffold carries no placeholder identity', () => {
  it('ships package.json without any author key', async () => {
    const pkg = await readJson('package.json')
    expect(Object.keys(pkg)).not.toContain('author')
  })

  it("drops the bundled template's author block instead of inheriting it", async () => {
    const pkg = await readProjectFile('package.json')
    expect(pkg).not.toContain('Cezar Augusto')
    expect(pkg).not.toContain('boss@cezaraugusto.net')
    expect(pkg).not.toContain('cezaraugusto.com')
  })

  it('does not guess an author from the git identity either', async () => {
    const pkg = await readProjectFile('package.json')
    expect(pkg).not.toContain(IDENTITY_NAME)
    expect(pkg).not.toContain(IDENTITY_EMAIL)
  })

  it('never writes Your Name anywhere in the project', async () => {
    const pkg = await readProjectFile('package.json')
    const manifest = await readProjectFile('src', 'manifest.json')
    const store = await readProjectFile('STORE.md')
    expect(pkg).not.toContain('Your Name')
    expect(pkg).not.toContain('your@email.com')
    expect(pkg).not.toContain('yourwebsite.com')
    expect(manifest).not.toContain('Your Name')
    expect(store).not.toContain('Your Name')
  })

  it('leaves no author in the manifest for the user to disown', async () => {
    const manifest = await readJson('src', 'manifest.json')
    expect(manifest.author).toBeUndefined()
    expect(manifest.name).toBe('my-extension')
  })

  it('omits the pnpm settings block when pnpm is not the package manager', async () => {
    const pkg = await readJson('package.json')
    expect(pkg.pnpm).toBeUndefined()
  })
})

describe('STORE.md describes the extension, not the template', () => {
  it('names the project on the listing line', async () => {
    const store = await readProjectFile('STORE.md')
    expect(store).toMatch(/^- Name: my-extension$/m)
  })

  it('drops the template name the manifest no longer carries', async () => {
    const store = await readProjectFile('STORE.md')
    expect(store).not.toContain('JavaScript Sidebar Example')
  })

  it('dates itself the day the scaffold was written', async () => {
    const store = await readProjectFile('STORE.md')
    const today = new Date().toISOString().slice(0, 10)
    expect(store).toContain(`Last updated: ${today}`)
  })
})

describe('the first commit exists', () => {
  it('records one commit that names the template', () => {
    expect(git(['log', '--oneline'])).toContain(
      'Create my-extension from the javascript template'
    )
  })

  it('leaves nothing untracked', () => {
    expect(git(['status', '--porcelain'])).toBe('')
  })

  it('tracks the provenance record and the ignore file', () => {
    const tracked = git(['ls-files']).split('\n')
    expect(tracked).toContain('.extension-create.json')
    expect(tracked).toContain('.gitignore')
    expect(tracked).toContain('src/manifest.json')
  })
})
