import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

vi.mock('go-git-it', () => ({
  default: vi.fn(async () => {
    throw new Error('go-git-it should not be called for the bundled template')
  })
}))

vi.mock('axios', () => ({default: {get: vi.fn()}}))

import goGitIt from 'go-git-it'
import {importExternalTemplate} from '../import-external-template'

describe('importExternalTemplate', () => {
  const prevEnv = process.env.EXTENSION_ENV

  beforeEach(() => {
    process.env.EXTENSION_ENV = 'test'
  })

  afterEach(() => {
    process.env.EXTENSION_ENV = prevEnv
  })

  it('treats "init" as an alias for the bundled "javascript" template, offline', async () => {
    const tmpRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'ext-create-test-')
    )
    const projectPath = path.join(tmpRoot, 'my-ext')

    try {
      await importExternalTemplate(projectPath, 'my-ext', 'init', {
        log: () => {},
        error: () => {}
      })

      expect(fs.existsSync(path.join(projectPath, 'package.json'))).toBe(true)
      expect(
        fs.existsSync(path.join(projectPath, 'src', 'manifest.json'))
      ).toBe(true)
      expect(goGitIt).not.toHaveBeenCalled()
    } finally {
      try {
        await fsp.rm(tmpRoot, {recursive: true, force: true})
      } catch {
        // Ignore
      }
    }
  })
})
