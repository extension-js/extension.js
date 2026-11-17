import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {stripVTControlCharacters} from 'node:util'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
  importExternalTemplate,
  type TemplateClone
} from '../import-external-template'

const noopLogger = {log: () => {}, error: () => {}}
const url = 'https://github.com/acme/starters/tree/main/examples/content'

// Stands in for the clone: it leaves these files in the folder it is given.
function cloneLeaving(files: Record<string, string>) {
  return vi.fn<TemplateClone>(async (_url, destination) => {
    for (const [name, contents] of Object.entries(files)) {
      const target = path.join(destination, name)
      await fsp.mkdir(path.dirname(target), {recursive: true})
      await fsp.writeFile(target, contents)
    }
  })
}

describe('a GitHub template URL', () => {
  const savedEnv = {
    EXTENSION_ENV: process.env.EXTENSION_ENV,
    GIT_TERMINAL_PROMPT: process.env.GIT_TERMINAL_PROMPT
  }
  let workDir: string
  let projectPath: string

  beforeEach(async () => {
    process.env.EXTENSION_ENV = 'test'
    delete process.env.GIT_TERMINAL_PROMPT
    workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'extjs-github-'))
    projectPath = path.join(workDir, 'my-ext')
  })

  afterEach(async () => {
    for (const [name, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }

    await fsp.rm(workDir, {recursive: true, force: true})
  })

  function importing(clone: TemplateClone) {
    return importExternalTemplate(projectPath, 'my-ext', url, noopLogger, {
      ownsProjectDir: true,
      clone
    })
  }

  it('scaffolds the folder named after the template and leaves its siblings out', async () => {
    const clone = cloneLeaving({
      'content/manifest.json': '{"name":"from the content folder"}',
      'content/src/content.js': '// content\n',
      'README.md': '# the repository, not the template\n',
      'other/manifest.json': '{"name":"another template"}'
    })

    const provenance = await importing(clone)

    expect(provenance).toEqual({template: 'content', source: url})
    expect(
      await fsp.readFile(path.join(projectPath, 'manifest.json'), 'utf8')
    ).toBe('{"name":"from the content folder"}')

    expect((await fsp.readdir(projectPath)).sort()).toEqual([
      'manifest.json',
      'src'
    ])
  })

  it('scaffolds everything the clone left when no folder has the template name', async () => {
    const clone = cloneLeaving({
      'manifest.json': '{"name":"at the root"}',
      'src/content.js': '// content\n'
    })

    const provenance = await importing(clone)

    expect(provenance).toEqual({template: 'content', source: url})
    expect(
      await fsp.readFile(path.join(projectPath, 'manifest.json'), 'utf8')
    ).toBe('{"name":"at the root"}')

    expect((await fsp.readdir(projectPath)).sort()).toEqual([
      'manifest.json',
      'src'
    ])
  })

  it('clones into a staging folder that is gone afterwards', async () => {
    const clone = cloneLeaving({'content/manifest.json': '{}'})

    await importing(clone)

    const [asked, destination, message] = clone.mock.calls[0]

    expect(clone).toHaveBeenCalledTimes(1)
    expect(asked).toBe(url)
    expect(stripVTControlCharacters(message)).toContain(
      'Copying the template content'
    )

    expect(path.resolve(destination)).not.toBe(path.resolve(projectPath))
    expect(fs.existsSync(destination)).toBe(false)
  })

  it('keeps git from prompting during the clone and restores the environment', async () => {
    let duringClone: string | undefined
    const clone = vi.fn<TemplateClone>(async (_url, destination) => {
      duringClone = process.env.GIT_TERMINAL_PROMPT
      await fsp.writeFile(path.join(destination, 'manifest.json'), '{}')
    })

    await importing(clone)

    expect(duringClone).toBe('0')
    expect(process.env.GIT_TERMINAL_PROMPT).toBeUndefined()
  })
})
