import * as fs from 'fs'
import * as fsp from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'

// The production code imports `go-git-it` as a default export.
vi.mock('go-git-it', () => {
  return {
    default: vi.fn(async (_url: string, dest: string) => {
      // Simulate the examples repo layout where "init" is an alias for "javascript".
      // Intentionally do NOT create an "init/" folder to ensure the alias mapping is required.
      const templateDir = path.join(dest, 'javascript')
      await fsp.mkdir(templateDir, {recursive: true})
      await fsp.writeFile(
        path.join(templateDir, 'manifest.json'),
        JSON.stringify({name: 'x', version: '0.0.1', manifest_version: 3})
      )
    })
  }
})

import {importExternalTemplate} from '../import-external-template'

describe('importExternalTemplate', () => {
  const prevEnv = process.env.EXTENSION_ENV

  beforeEach(() => {
    process.env.EXTENSION_ENV = 'test'
  })

  afterEach(() => {
    process.env.EXTENSION_ENV = prevEnv
  })

  it('treats "init" as an alias for "javascript" when fetching built-in examples', async () => {
    const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'ext-create-test-'))
    const projectPath = path.join(tmpRoot, 'my-ext')

    try {
      await importExternalTemplate(projectPath, 'my-ext', 'init')
      expect(fs.existsSync(path.join(projectPath, 'manifest.json'))).toBe(true)
    } finally {
      try {
        await fsp.rm(tmpRoot, {recursive: true, force: true})
      } catch {
        // ignore cleanup errors
      }
    }
  })
})

