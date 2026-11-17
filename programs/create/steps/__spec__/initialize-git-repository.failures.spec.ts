import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {type FakeRun, fakeSpawn, missingBinary} from '../../__spec__/fake-spawn'
import {initializeGitRepository} from '../initialize-git-repository'

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')
const SCAFFOLD = {
  'package.json': '{"name":"my-extension"}\n',
  'src/a.js': '1\n'
}
const identity = () => ({name: 'Scaffold Tester', email: 'tester@example.com'})

let projectPath: string

beforeEach(async () => {
  // The notice count is about user-facing output, so the debug trace is off.
  vi.stubEnv('EXTENSION_DEBUG', '')
  vi.stubEnv('EXTENSION_AUTHOR_MODE', '')
  vi.stubEnv('EXTENSION_ENV', '')
  projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'extjs-git-fail-'))

  for (const [file, contents] of Object.entries(SCAFFOLD)) {
    await fs.mkdir(path.dirname(path.join(projectPath, file)), {
      recursive: true
    })

    await fs.writeFile(path.join(projectPath, file), contents)
  }
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await fs.rm(projectPath, {recursive: true, force: true})
})

function recordingLogger() {
  const notices: string[] = []
  const record = (...args: unknown[]) =>
    notices.push(args.map(String).join(' ').replace(ANSI, ''))

  return {notices, logger: {log: record, error: record}}
}

async function scaffoldOnDisk() {
  const files: Record<string, string> = {}

  for (const file of Object.keys(SCAFFOLD)) {
    files[file] = await fs.readFile(path.join(projectPath, file), 'utf8')
  }

  return {files, entries: (await fs.readdir(projectPath)).sort()}
}

// A fresh folder: no repository yet, and every git step works unless the
// test names the one that fails.
function gitWhere(failing: Record<string, FakeRun>) {
  return fakeSpawn((_command, args) => {
    const subcommand = args.find((arg) => arg in failing)
    if (subcommand) return failing[subcommand]

    return args.includes('rev-parse') ? {exit: 128} : {exit: 0}
  })
}

const subcommands = (calls: {args: string[]}[]) =>
  calls.map(({args}) =>
    args.find((arg) => ['rev-parse', 'init', 'add', 'commit'].includes(arg))
  )

describe('initializeGitRepository when git fails', () => {
  it('leaves the scaffold in place with one notice when git is missing', async () => {
    const {spawn, calls} = fakeSpawn((command) => ({
      error: missingBinary(command)
    }))
    const {notices, logger} = recordingLogger()

    await expect(
      initializeGitRepository(projectPath, 'my-extension', 'react', logger, {
        spawn,
        readIdentity: identity
      })
    ).resolves.toBeUndefined()

    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatch(
      /^\S+ Skipping the git init for my-extension\.\nREASON git not found\nRun git init yourself if you want version control\.$/
    )

    expect(calls.map((call) => call.command)).toEqual(['git', 'git'])
    expect(subcommands(calls)).toEqual(['rev-parse', 'init'])
    expect(await scaffoldOnDisk()).toEqual({
      files: SCAFFOLD,
      entries: ['package.json', 'src']
    })
  })

  it.each([
    {
      step: 'init',
      run: {
        exit: 128,
        stderr: 'fatal: cannot mkdir .git: Permission denied\n'
      },
      notice:
        'Skipping the git init for my-extension.\n' +
        'REASON git init exited with 128: fatal: cannot mkdir .git: Permission denied\n' +
        'Run git init yourself if you want version control.',
      ran: ['rev-parse', 'init']
    },
    {
      step: 'add',
      run: {
        exit: 128,
        stderr:
          'error: open("locked.txt"): Permission denied\n' +
          "error: unable to index file 'locked.txt'\n" +
          'fatal: adding files failed\n'
      },
      notice:
        'Left my-extension uncommitted.\n' +
        'REASON git add exited with 128: error: open("locked.txt"): Permission denied\n' +
        'Run git add -A && git commit to record the scaffold.',
      ran: ['rev-parse', 'init', 'add']
    },
    {
      step: 'commit',
      run: {
        exit: 128,
        stderr:
          'hint: set your identity before the first commit\n' +
          'Author identity unknown\n\n' +
          '*** Please tell me who you are.\n\n' +
          "fatal: unable to auto-detect email address (got 'me@host.(none)')\n"
      },
      notice:
        'Left my-extension uncommitted.\n' +
        "REASON git commit exited with 128: fatal: unable to auto-detect email address (got 'me@host.(none)')\n" +
        'Run git add -A && git commit to record the scaffold.',
      ran: ['rev-parse', 'init', 'add', 'commit']
    }
  ])('leaves the scaffold in place with one notice that carries the reason when git $step fails', async ({
    step,
    run,
    notice,
    ran
  }) => {
    const {spawn, calls} = gitWhere({[step]: run})
    const {notices, logger} = recordingLogger()

    // A failed git step is a notice, never a failed create.
    await expect(
      initializeGitRepository(projectPath, 'my-extension', 'react', logger, {
        spawn,
        readIdentity: identity
      })
    ).resolves.toBeUndefined()

    expect(notices).toHaveLength(1)
    expect(notices[0].replace(/^\S+ /, '')).toBe(notice)
    // Three lines and no stack: the headline, the reason, the way forward.
    expect(notices[0].split('\n')).toHaveLength(3)
    expect(notices[0]).not.toMatch(/^\s+at /m)

    expect(subcommands(calls)).toEqual(ran)
    expect(await scaffoldOnDisk()).toEqual({
      files: SCAFFOLD,
      entries: ['package.json', 'src']
    })
  })

  it('reports the exit code alone when git wrote nothing to stderr', async () => {
    const {spawn} = gitWhere({add: {exit: 1}})
    const {notices, logger} = recordingLogger()

    await initializeGitRepository(
      projectPath,
      'my-extension',
      'react',
      logger,
      {
        spawn,
        readIdentity: identity
      }
    )

    expect(notices).toHaveLength(1)
    expect(notices[0].split('\n')[1]).toBe('REASON git add exited with 1')
  })

  it('keeps a long stderr to one reason line', async () => {
    const {spawn} = gitWhere({
      init: {exit: 128, stderr: `fatal: ${'x'.repeat(900)}\nfatal: second\n`}
    })
    const {notices, logger} = recordingLogger()

    await initializeGitRepository(
      projectPath,
      'my-extension',
      'react',
      logger,
      {
        spawn,
        readIdentity: identity
      }
    )

    expect(notices[0].split('\n')).toHaveLength(3)
    expect(notices[0].split('\n')[1]).toBe(
      `REASON git init exited with 128: fatal: ${'x'.repeat(293)}…`
    )
  })

  it('says the files are uncommitted when git has no identity, and stages nothing', async () => {
    const {spawn, calls} = gitWhere({})
    const {notices, logger} = recordingLogger()

    await initializeGitRepository(
      projectPath,
      'my-extension',
      'react',
      logger,
      {
        spawn,
        readIdentity: () => ({name: 'Only A Name'})
      }
    )

    expect(notices).toHaveLength(1)
    expect(notices[0].replace(/^\S+ /, '')).toBe(
      'Left my-extension uncommitted.\n' +
        'REASON no git user identity\n' +
        'Run git add -A && git commit to record the scaffold.'
    )

    expect(subcommands(calls)).toEqual(['rev-parse', 'init'])
  })

  it('commits unsigned, without hooks or prompts, reading only stderr', async () => {
    const {spawn, calls} = gitWhere({})
    const {notices, logger} = recordingLogger()

    await initializeGitRepository(
      projectPath,
      'my-extension',
      'react',
      logger,
      {
        spawn,
        readIdentity: identity
      }
    )

    expect(notices).toEqual([])
    expect(calls.map((call) => call.args)).toEqual([
      ['rev-parse', '--is-inside-work-tree'],
      ['init', '--quiet'],
      ['add', '--all'],
      [
        '-c',
        'commit.gpgsign=false',
        'commit',
        '--quiet',
        '--no-verify',
        '--message',
        'Create my-extension from the react template'
      ]
    ])

    for (const call of calls) {
      expect(call.options.cwd).toBe(projectPath)
      expect(call.options.stdio).toEqual(['ignore', 'ignore', 'pipe'])
      expect(call.options.env?.GIT_TERMINAL_PROMPT).toBe('0')
      expect(call.options).not.toHaveProperty('shell')
    }
  })

  it('leaves a repository that already has history alone', async () => {
    const {spawn, calls} = fakeSpawn(() => ({exit: 0}))
    const {notices, logger} = recordingLogger()

    await initializeGitRepository(
      projectPath,
      'my-extension',
      'react',
      logger,
      {
        spawn,
        readIdentity: identity
      }
    )

    expect(calls.map((call) => call.args)).toEqual([
      ['rev-parse', '--is-inside-work-tree'],
      ['rev-parse', '--verify', 'HEAD']
    ])

    expect(notices).toHaveLength(1)
    expect(notices[0].replace(/^\S+ /, '')).toBe(
      'my-extension is already a git repository with history.\n' +
        'Left it uncommitted. Review the scaffold and run git add -A && git commit yourself.'
    )
  })
})
