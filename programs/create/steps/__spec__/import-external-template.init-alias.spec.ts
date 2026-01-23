import * as fs from 'fs'
import * as fsp from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'

// The built-in template download should not require git.
vi.mock('go-git-it', () => ({default: vi.fn(async () => { throw new Error('git should not be used') })}))

// Mock ZIP download of the examples repo.
vi.mock('axios', async () => {
  const AdmZip = (await import('adm-zip')).default
  const zip = new AdmZip()
  // Simulate a GitHub codeload zip: "<repo>-main/examples/javascript/..."
  zip.addFile(
    'examples-main/examples/javascript/manifest.json',
    Buffer.from(JSON.stringify({name: 'x', version: '0.0.1', manifest_version: 3}))
  )
  return {
    default: {
      get: vi.fn(async () => ({data: zip.toBuffer(), headers: {'content-type': 'application/zip'}}))
    }
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

