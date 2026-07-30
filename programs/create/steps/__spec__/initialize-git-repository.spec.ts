import {sync as spawnSync} from 'cross-spawn'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {
  firstCommitSubject,
  initializeGitRepository
} from '../initialize-git-repository'

const savedEnv = {
  GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
  GIT_CONFIG_SYSTEM: process.env.GIT_CONFIG_SYSTEM
}

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

async function withProject(
  identity: {name: string; email: string} | undefined,
  fn: (projectPath: string) => Promise<void>
) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'extjs-create-git-'))
  try {
    const configPath = path.join(dir, 'gitconfig')
    await fs.writeFile(
      configPath,
      identity
        ? `[user]\n\tname = ${identity.name}\n\temail = ${identity.email}\n[init]\n\tdefaultBranch = main\n`
        : '[init]\n\tdefaultBranch = main\n'
    )
    process.env.GIT_CONFIG_GLOBAL = configPath
    process.env.GIT_CONFIG_SYSTEM = '/dev/null'

    const projectPath = path.join(dir, 'my-extension')
    await fs.mkdir(projectPath, {recursive: true})
    await fs.writeFile(path.join(projectPath, 'package.json'), '{}\n')
    await fs.writeFile(path.join(projectPath, '.gitignore'), 'node_modules\n')
    await fs.mkdir(path.join(projectPath, 'node_modules', 'left'), {
      recursive: true
    })
    await fs.writeFile(
      path.join(projectPath, 'node_modules', 'left', 'index.js'),
      'module.exports = 1\n'
    )
    await fn(projectPath)
  } finally {
    await fs.rm(dir, {recursive: true, force: true})
  }
}

function git(projectPath: string, args: string[]) {
  return String(
    spawnSync('git', args, {cwd: projectPath, encoding: 'utf8'}).stdout || ''
  ).trim()
}

describe('firstCommitSubject', () => {
  it('names the template the scaffold came from', () => {
    expect(firstCommitSubject('my-extension', 'javascript')).toBe(
      'Create my-extension from the javascript template'
    )
  })

  it('drops the template when the subject would run long', () => {
    const long = 'a'.repeat(60)
    expect(firstCommitSubject(long, 'javascript')).toBe(`Create ${long}`)
  })

  it('falls back to a plain subject when even the name runs long', () => {
    expect(firstCommitSubject('b'.repeat(100), 'javascript')).toBe(
      'Initial commit'
    )
  })
})

describe('initializeGitRepository', () => {
  it('commits the scaffold so nothing is left untracked', async () => {
    await withProject(
      {name: 'Scaffold Tester', email: 'scaffold@example.com'},
      async (projectPath) => {
        const lines: string[] = []
        const logger = {
          log: (...args: unknown[]) => lines.push(args.join(' ')),
          error: (...args: unknown[]) => lines.push(args.join(' '))
        }

        await initializeGitRepository(
          projectPath,
          'my-extension',
          'javascript',
          logger
        )

        expect(git(projectPath, ['status', '--porcelain'])).toBe('')
        expect(git(projectPath, ['log', '--oneline'])).toContain(
          'Create my-extension from the javascript template'
        )
        expect(lines.join('\n')).toBe('')
      }
    )
  }, 30000)

  it('never commits an ignored dependency tree', async () => {
    await withProject(
      {name: 'Scaffold Tester', email: 'scaffold@example.com'},
      async (projectPath) => {
        await initializeGitRepository(
          projectPath,
          'my-extension',
          'javascript',
          console
        )
        expect(git(projectPath, ['ls-files'])).not.toContain('node_modules')
      }
    )
  }, 30000)

  it('says the files are uncommitted when git has no identity', async () => {
    await withProject(undefined, async (projectPath) => {
      const lines: string[] = []
      const logger = {
        log: (...args: unknown[]) => lines.push(args.join(' ')),
        error: (...args: unknown[]) => lines.push(args.join(' '))
      }

      await initializeGitRepository(
        projectPath,
        'my-extension',
        'javascript',
        logger
      )

      expect(lines.join('\n')).toContain('Left my-extension uncommitted')
      expect(lines.join('\n')).toContain('no git user identity')
      expect(git(projectPath, ['status', '--porcelain'])).not.toBe('')
    })
  }, 30000)
})
