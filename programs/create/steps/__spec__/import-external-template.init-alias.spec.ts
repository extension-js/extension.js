import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

vi.mock('go-git-it', () => ({default: vi.fn(async () => {})}))
vi.mock('axios', () => ({
  default: {
    get: vi.fn(async () => {
      throw new Error('network is disabled in this test')
    })
  }
}))

import axios from 'axios'
import {importExternalTemplate} from '../import-external-template'

describe('importExternalTemplate', () => {
  const prevEnv = process.env.EXTENSION_ENV

  beforeEach(() => {
    process.env.EXTENSION_ENV = 'test'
    vi.mocked(axios.get).mockClear()
  })

  afterEach(() => {
    process.env.EXTENSION_ENV = prevEnv
  })

  // `init` used to be an alias that scaffolded the bundled `javascript`
  // template, a sidebar extension, while a genuinely different `init` folder
  // sat in the catalog holding a bare manifest. It was offline and it was
  // wrong, and eleven people typed it in the ninety days before 2026-07-30.
  // Cezar ruled that a name delivers what it says, so `init` now resolves like
  // any other catalog name and pays the network cost every non-default
  // template pays. The bundled offline path still exists and still belongs to
  // the default, which is what `create` with no flag gets.
  it('fetches the init folder rather than substituting the bundled template', async () => {
    const tmpRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'ext-create-test-')
    )
    const projectPath = path.join(tmpRoot, 'my-ext')

    try {
      await expect(
        importExternalTemplate(projectPath, 'my-ext', 'init', {
          log: () => {},
          error: () => {}
        })
      ).rejects.toThrow()

      // The download was attempted, which is the whole point: the bundled
      // javascript copy is no longer silently substituted for this name.
      expect(vi.mocked(axios.get)).toHaveBeenCalled()
      expect(
        fs.existsSync(path.join(projectPath, 'src', 'manifest.json'))
      ).toBe(false)
    } finally {
      try {
        await fsp.rm(tmpRoot, {recursive: true, force: true})
      } catch {
        // Ignore
      }
    }
  })
})
