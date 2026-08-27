import {spawnSync} from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
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
