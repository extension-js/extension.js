import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {sync as spawnSync} from 'cross-spawn'
import {afterEach, describe, expect, it} from 'vitest'
import {writeGitignore} from '../write-gitignore'

const templateGitignore = [
  '# See https://help.github.com/articles/ignoring-files/ for more about ignoring files.',
  '',
  '# dependencies',
  'node_modules',
  '',
  '# testing',
  'coverage',
  '',
  '# production',
  'dist',
  '',
  '# misc',
  '.DS_Store',
  '',
  '# local env files',
  '.env.local',
  '.env.development.local',
  '.env.test.local',
  '.env.production.local',
  '',
  '# lock files',
  'yarn.lock',
  'package-lock.json',
  '',
  '# debug files',
  'npm-debug.log*',
  'yarn-debug.log*',
  'yarn-error.log*',
  '',
  '# extension.js',
  'extension-env.d.ts',
  '',
  '# extension.js local session state',
  '.extension-js',
  ''
].join('\n')

const perBrowserEnvFiles = [
  '.env.chrome',
  '.env.chromium',
  '.env.chromium-based',
  '.env.edge',
  '.env.firefox',
  '.env.gecko-based'
]

const secretEnvFiles = [
  '.env',
  '.env.local',
  '.env.chrome.local',
  '.env.development.local'
]

// Files the framework or a deploy step reads, which hold keys as often as not.
const realEnvFiles = [
  '.env.development',
  '.env.production',
  '.env.staging',
  '.env.backup'
]

const tmpRoots: string[] = []

afterEach(async () => {
  for (const dir of tmpRoots.splice(0)) {
    await fsp.rm(dir, {recursive: true, force: true})
  }
})

async function projectWith(gitignore: string | null) {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'ext-create-test-'))
  tmpRoots.push(tmpRoot)
  const projectPath = path.join(tmpRoot, 'my-ext')
  await fsp.mkdir(projectPath, {recursive: true})

  if (gitignore !== null) {
    await fsp.writeFile(path.join(projectPath, '.gitignore'), gitignore)
  }

  return projectPath
}

// One git process for every file at once: a spawn per file took the cell
// past its budget on a slow Windows runner.
function ignoredByGit(projectPath: string, files: string[]) {
  const result = spawnSync('git', ['check-ignore', '--stdin'], {
    cwd: projectPath,
    input: `${files.join('\n')}\n`,
    encoding: 'utf8'
  })
  const ignored = new Set(String(result.stdout || '').split('\n'))

  return files.map((file) => [file, ignored.has(file)])
}

const GIT_CELL_TIMEOUT_MS = 60_000

function headersWithNothingUnderThem(contents: string) {
  const lines = contents.split('\n')

  return lines.filter((line, index) => {
    if (!line.startsWith('#') || line === lines[0]) return false

    const next = lines[index + 1]

    return next === undefined || next === '' || next.startsWith('#')
  })
}

describe('writeGitignore', () => {
  it('appends missing defaults when .gitignore has no trailing newline', async () => {
    const projectPath = await projectWith('custom-entry')

    await writeGitignore(projectPath, console)

    const contents = await fsp.readFile(
      path.join(projectPath, '.gitignore'),
      'utf8'
    )
    expect(contents.startsWith('custom-entry\n\n# See ')).toBe(true)
    expect(contents).toContain('\nnode_modules')
    expect(contents).toContain('\ncoverage')
  })

  it(
    'ignores every env file by default and keeps the example templates',
    async () => {
      const projectPath = await projectWith(null)

      await writeGitignore(projectPath, console)
      spawnSync('git', ['init', '-q'], {cwd: projectPath})

      const contents = await fsp.readFile(
        path.join(projectPath, '.gitignore'),
        'utf8'
      )
      const lines = contents.split('\n')
      expect(lines.filter((line) => line.includes('.env'))).toEqual([
        '.env*',
        '!.env.example',
        '!.env.*.example'
      ])

      const hidden = [...secretEnvFiles, ...realEnvFiles]
      const kept = ['.env.example', '.env.production.example']
      expect(ignoredByGit(projectPath, [...hidden, ...kept])).toEqual([
        ...hidden.map((file) => [file, true]),
        ...kept.map((file) => [file, false])
      ])
    },
    GIT_CELL_TIMEOUT_MS
  )

  it(
    'keeps the per-browser env files a template ships out of the ignore rules',
    async () => {
      const projectPath = await projectWith(templateGitignore)

      for (const file of [...perBrowserEnvFiles, ...secretEnvFiles]) {
        await fsp.writeFile(
          path.join(projectPath, file),
          'EXTENSION_PUBLIC_X=1\n'
        )
      }

      await writeGitignore(projectPath, console)

      spawnSync('git', ['init', '-q'], {cwd: projectPath})

      const hidden = [...secretEnvFiles, ...realEnvFiles]
      expect(
        ignoredByGit(projectPath, [...perBrowserEnvFiles, ...hidden])
      ).toEqual([
        ...perBrowserEnvFiles.map((file) => [file, false]),
        ...hidden.map((file) => [file, true])
      ])
    },
    GIT_CELL_TIMEOUT_MS
  )

  it(
    're-allows only the env files the template put there, never the owner ones',
    async () => {
      const projectPath = await projectWith(null)

      for (const file of [
        '.env.chrome',
        '.env.production',
        '.env',
        '.env.local'
      ]) {
        await fsp.writeFile(path.join(projectPath, file), 'X=1\n')
      }

      await writeGitignore(projectPath, console, {
        ownedEntries: ['.env.production', 'notes.txt']
      })

      spawnSync('git', ['init', '-q'], {cwd: projectPath})

      const contents = await fsp.readFile(
        path.join(projectPath, '.gitignore'),
        'utf8'
      )
      expect(
        contents.split('\n').filter((line) => line.startsWith('!'))
      ).toEqual(['!.env.example', '!.env.*.example', '!.env.chrome'])

      expect(
        ignoredByGit(projectPath, [
          '.env.chrome',
          '.env.production',
          '.env',
          '.env.local'
        ])
      ).toEqual([
        ['.env.chrome', false],
        ['.env.production', true],
        ['.env', true],
        ['.env.local', true]
      ])
    },
    GIT_CELL_TIMEOUT_MS
  )

  it('appends whole groups under one header each, with a trailing newline', async () => {
    const projectPath = await projectWith(templateGitignore)

    await writeGitignore(projectPath, console)

    const contents = await fsp.readFile(
      path.join(projectPath, '.gitignore'),
      'utf8'
    )

    expect(contents).toBe(
      `${templateGitignore}\n# local env files\n.env*\n!.env.example\n!.env.*.example\n`
    )

    expect(contents).not.toMatch(/\n\n\n/)
    expect(contents.endsWith('\n\n')).toBe(false)
    expect(headersWithNothingUnderThem(contents)).toEqual([])
    expect(contents.match(/local session state/gi)).toHaveLength(1)
    expect(contents.match(/^# See /gm)).toHaveLength(1)
  })

  it('is idempotent when run multiple times', async () => {
    const projectPath = await projectWith(null)
    const gitIgnorePath = path.join(projectPath, '.gitignore')

    await writeGitignore(projectPath, console)
    const firstPass = await fsp.readFile(gitIgnorePath, 'utf8')

    await writeGitignore(projectPath, console)
    const secondPass = await fsp.readFile(gitIgnorePath, 'utf8')

    expect(secondPass).toBe(firstPass)
    expect(secondPass.match(/(^|\n)node_modules(\n|$)/g)?.length).toBe(1)
    expect(secondPass.endsWith('\n')).toBe(true)
    expect(secondPass.endsWith('\n\n')).toBe(false)
  })
})
