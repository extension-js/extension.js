import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {importExternalTemplate} from '../steps/import-external-template'

const OWNER_GITIGNORE = 'owner-only-rule\n'
const OWNER_MCP_CONFIG = '{"mcpServers":{"mine":{"command":"true"}}}'

describe('a create that fails partway in an existing folder', () => {
  let root: string
  let project: string
  let template: string
  const logger = {log() {}, error() {}}

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'extjs-failed-import-'))
    project = path.join(root, 'project')
    template = path.join(root, 'template')

    await fs.mkdir(project)
    await fs.writeFile(path.join(project, '.gitignore'), OWNER_GITIGNORE)
    await fs.writeFile(path.join(project, '.mcp.json'), OWNER_MCP_CONFIG)

    // The hidden files copy first, then the copy stops on a file it cannot read.
    await fs.mkdir(template)
    await fs.writeFile(path.join(template, '.gitignore'), 'template-rule\n')
    await fs.writeFile(path.join(template, '.mcp.json'), '{"shipped":true}\n')
    await fs.writeFile(path.join(template, 'manifest.json'), '{}')
    await fs.writeFile(path.join(template, 'zz-unreadable.txt'), 'x')
    await fs.chmod(path.join(template, 'zz-unreadable.txt'), 0o000)
  })

  afterEach(async () => {
    await fs
      .chmod(path.join(template, 'zz-unreadable.txt'), 0o644)
      .catch(() => {})

    await fs.rm(root, {recursive: true, force: true})
  })

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'puts the owner files back byte for byte and removes what it added',
    async () => {
      await expect(
        importExternalTemplate(project, 'project', template, logger)
      ).rejects.toThrow()

      expect(await fs.readFile(path.join(project, '.gitignore'), 'utf8')).toBe(
        OWNER_GITIGNORE
      )

      expect(await fs.readFile(path.join(project, '.mcp.json'), 'utf8')).toBe(
        OWNER_MCP_CONFIG
      )

      expect((await fs.readdir(project)).sort()).toEqual([
        '.gitignore',
        '.mcp.json'
      ])
    }
  )
})
