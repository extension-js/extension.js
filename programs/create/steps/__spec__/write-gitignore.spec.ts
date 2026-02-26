import * as fsp from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import {describe, it, expect} from 'vitest'
import {writeGitignore} from '../write-gitignore'

describe('writeGitignore', () => {
  it('appends missing defaults when .gitignore has no trailing newline', async () => {
    const tmpRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'ext-create-test-')
    )
    const projectPath = path.join(tmpRoot, 'my-ext')
    const gitIgnorePath = path.join(projectPath, '.gitignore')

    try {
      await fsp.mkdir(projectPath, {recursive: true})
      await fsp.writeFile(gitIgnorePath, 'custom-entry')

      await writeGitignore(projectPath)

      const contents = await fsp.readFile(gitIgnorePath, 'utf8')
      expect(contents.startsWith('custom-entry\n# See ')).toBe(true)
      expect(contents).toContain('\nnode_modules')
      expect(contents).toContain('\ncoverage')
    } finally {
      await fsp.rm(tmpRoot, {recursive: true, force: true})
    }
  })

  it('is idempotent when run multiple times', async () => {
    const tmpRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'ext-create-test-')
    )
    const projectPath = path.join(tmpRoot, 'my-ext')
    const gitIgnorePath = path.join(projectPath, '.gitignore')

    try {
      await fsp.mkdir(projectPath, {recursive: true})

      await writeGitignore(projectPath)
      const firstPass = await fsp.readFile(gitIgnorePath, 'utf8')

      await writeGitignore(projectPath)
      const secondPass = await fsp.readFile(gitIgnorePath, 'utf8')

      expect(secondPass).toBe(firstPass)
      expect(secondPass.match(/(^|\n)node_modules(\n|$)/g)?.length).toBe(1)
    } finally {
      await fsp.rm(tmpRoot, {recursive: true, force: true})
    }
  })
})
