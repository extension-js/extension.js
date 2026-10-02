import {spawnSync} from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {ensureSessionStateInProjectGitignore} from '../session-paths'

const created: string[] = []

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-gitignore-'))
  created.push(dir)

  return dir
}

afterEach(() => {
  for (const dir of created) {
    try {
      fs.rmSync(dir, {recursive: true, force: true})
    } catch {
      // Ignore
    }
  }

  created.length = 0
})

describe('ensureSessionStateInProjectGitignore', () => {
  it('appends .extension-js to an adopted project gitignore', () => {
    const root = makeTempDir()
    const gitignorePath = path.join(root, '.gitignore')
    fs.writeFileSync(gitignorePath, 'node_modules\ndist\n')

    ensureSessionStateInProjectGitignore(root)

    const contents = fs.readFileSync(gitignorePath, 'utf8')
    expect(contents.startsWith('node_modules\ndist\n')).toBe(true)
    expect(contents.split('\n')).toContain('.extension-js')
  })

  it('is idempotent and respects an existing .extension-js line', () => {
    const root = makeTempDir()
    const gitignorePath = path.join(root, '.gitignore')
    fs.writeFileSync(gitignorePath, 'dist\n.extension-js\n')

    ensureSessionStateInProjectGitignore(root)
    expect(fs.readFileSync(gitignorePath, 'utf8')).toBe('dist\n.extension-js\n')

    fs.writeFileSync(gitignorePath, 'dist\n.extension-js/\n')
    ensureSessionStateInProjectGitignore(root)
    expect(fs.readFileSync(gitignorePath, 'utf8')).toBe(
      'dist\n.extension-js/\n'
    )
  })

  it('appends only once across repeated dev sessions', () => {
    const root = makeTempDir()
    const gitignorePath = path.join(root, '.gitignore')
    fs.writeFileSync(gitignorePath, 'dist')

    ensureSessionStateInProjectGitignore(root)
    const first = fs.readFileSync(gitignorePath, 'utf8')
    ensureSessionStateInProjectGitignore(root)
    const second = fs.readFileSync(gitignorePath, 'utf8')

    expect(second).toBe(first)
    expect(first.match(/\.extension-js/g)?.length).toBe(1)
  })

  // Regression: a monorepo ignores the path once at its root, so appending per
  // project turned every build in a 53-example repo into a dirty working tree.
  it('skips the append when an outer .gitignore already covers the path', () => {
    const repoRoot = makeTempDir()
    const git = (...args: string[]) =>
      spawnSync('git', args, {cwd: repoRoot, stdio: 'ignore'})

    git('init')
    fs.writeFileSync(path.join(repoRoot, '.gitignore'), '.extension-js/\n')

    const projectPath = path.join(repoRoot, 'examples', 'content')
    fs.mkdirSync(projectPath, {recursive: true})
    const gitignorePath = path.join(projectPath, '.gitignore')
    fs.writeFileSync(gitignorePath, 'dist\n')

    ensureSessionStateInProjectGitignore(projectPath)

    expect(fs.readFileSync(gitignorePath, 'utf8')).toBe('dist\n')
  })

  it('never creates a .gitignore where none exists', () => {
    const root = makeTempDir()

    ensureSessionStateInProjectGitignore(root)

    expect(fs.existsSync(path.join(root, '.gitignore'))).toBe(false)
  })
})

describe('the append is announced', () => {
  it('prints the gitignore path once the line is added', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-gitignore-say-'))
    fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules\n')

    ensureSessionStateInProjectGitignore(dir)
    ensureSessionStateInProjectGitignore(dir)

    const printed = log.mock.calls.map((call) => String(call[0])).join('\n')
    expect(printed).toContain('.extension-js')
    expect(printed).toContain(path.join(dir, '.gitignore'))
    expect(log).toHaveBeenCalledTimes(1)
    log.mockRestore()
    fs.rmSync(dir, {recursive: true, force: true})
  })

  it('keeps the line off stdout when stdout belongs to a machine', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-gitignore-json-'))
    fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules\n')
    vi.stubEnv('EXTENSION_OUTPUT', 'json')

    try {
      ensureSessionStateInProjectGitignore(dir)

      expect(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8')).toContain(
        '.extension-js'
      )

      expect(log).not.toHaveBeenCalled()
      expect(error).toHaveBeenCalledTimes(1)
      expect(String(error.mock.calls[0][0])).toContain(
        path.join(dir, '.gitignore')
      )
    } finally {
      vi.unstubAllEnvs()
      log.mockRestore()
      error.mockRestore()
      fs.rmSync(dir, {recursive: true, force: true})
    }
  })
})
