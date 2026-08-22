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
import {strToU8, zipSync} from 'fflate'
import {extensionCreate} from '../../module'
import {importExternalTemplate} from '../import-external-template'

// A miniature examples archive with the two folders the old alias confused,
// plus one more, each carrying a manifest that names its own folder so a
// substitution anywhere in the pipeline shows up as the wrong bytes.
function catalogZipWith(names: string[]): Buffer {
  const entries: Record<string, Uint8Array> = {}
  for (const name of names) {
    entries[`examples-main/examples/${name}/src/manifest.json`] = strToU8(
      JSON.stringify({name: `${name} marker`})
    )
    entries[`examples-main/examples/${name}/src/index.js`] = strToU8(
      `// ${name}\n`
    )
  }
  return Buffer.from(zipSync(entries))
}

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
    vi.mocked(axios.get).mockRejectedValue(
      new Error('network is disabled in this test')
    )

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

  it('scaffolds the init folder bytes and records init in provenance', async () => {
    const tmpRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'ext-create-test-')
    )
    const projectPath = path.join(tmpRoot, 'my-ext')
    vi.mocked(axios.get).mockResolvedValue({
      data: catalogZipWith(['init', 'javascript'])
    } as never)

    try {
      const provenance = await importExternalTemplate(
        projectPath,
        'my-ext',
        'init',
        {log: () => {}, error: () => {}}
      )

      expect(provenance.template).toBe('init')
      expect(provenance.source).toContain('codeload.github.com')

      const manifest = JSON.parse(
        await fsp.readFile(
          path.join(projectPath, 'src', 'manifest.json'),
          'utf-8'
        )
      )
      expect(manifest.name).toBe('init marker')
    } finally {
      try {
        await fsp.rm(tmpRoot, {recursive: true, force: true})
      } catch {
        // Ignore
      }
    }
  })

  // The session header used to be the last place the old alias survived: it
  // printed `Template javascript` for a `--template init` run even after the
  // scaffold itself became truthful. The card must name what the user typed.
  it('prints the requested name in the session header, not a substitute', async () => {
    const tmpRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'ext-create-test-')
    )
    const projectPath = path.join(tmpRoot, 'my-ext')
    vi.mocked(axios.get).mockResolvedValue({
      data: catalogZipWith(['init', 'javascript'])
    } as never)

    const captured: string[] = []
    const logger = {
      log: (...args: unknown[]) => {
        captured.push(args.map(String).join(' '))
      },
      error: () => {}
    }

    try {
      await extensionCreate(projectPath, {template: 'init', logger})

      const all = captured.join('\n')
      expect(all).toContain('init')
      expect(all).not.toContain('javascript')
    } finally {
      try {
        await fsp.rm(tmpRoot, {recursive: true, force: true})
      } catch {
        // Ignore
      }
    }
  })

  // The class guarantee behind section 126: whatever catalog name the user
  // types, the provenance names it and the scaffold is that folder's bytes.
  // No code path may swap one name for another without saying so. Exactly one
  // says so now: a renamed template answers to its old name, and the test
  // below pins what the user is told when that happens.
  // A template that was renamed keeps answering to the name it shipped under.
  // The bytes are the CANONICAL folder's, and provenance says so rather than
  // echoing what was typed: a user who asked for `new-react` should learn that
  // the template is now `newtab-react`, not be told a name that no longer
  // exists in the catalog.
  it('resolves a renamed template and reports the name it resolved to', async () => {
    const tmpRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'ext-create-test-')
    )
    const projectPath = path.join(tmpRoot, 'my-ext')
    vi.mocked(axios.get).mockResolvedValue({
      data: catalogZipWith(['init', 'javascript', 'newtab-react'])
    } as never)

    try {
      const provenance = await importExternalTemplate(
        projectPath,
        'my-ext',
        'new-react',
        {log: () => {}, error: () => {}}
      )

      expect(provenance.template).toBe('newtab-react')

      const manifest = JSON.parse(
        await fsp.readFile(
          path.join(projectPath, 'src', 'manifest.json'),
          'utf-8'
        )
      )
      expect(manifest.name).toBe('newtab-react marker')
    } finally {
      try {
        await fsp.rm(tmpRoot, {recursive: true, force: true})
      } catch {
        // Ignore
      }
    }
  })

  it.each([
    'content',
    'newtab-react'
  ])('delivers %s itself, never a substitute', async (requested) => {
    const tmpRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'ext-create-test-')
    )
    const projectPath = path.join(tmpRoot, 'my-ext')
    vi.mocked(axios.get).mockResolvedValue({
      data: catalogZipWith(['init', 'javascript', 'content', 'newtab-react'])
    } as never)

    try {
      const provenance = await importExternalTemplate(
        projectPath,
        'my-ext',
        requested,
        {log: () => {}, error: () => {}}
      )

      expect(provenance.template).toBe(requested)

      const manifest = JSON.parse(
        await fsp.readFile(
          path.join(projectPath, 'src', 'manifest.json'),
          'utf-8'
        )
      )
      expect(manifest.name).toBe(`${requested} marker`)
    } finally {
      try {
        await fsp.rm(tmpRoot, {recursive: true, force: true})
      } catch {
        // Ignore
      }
    }
  })
})
