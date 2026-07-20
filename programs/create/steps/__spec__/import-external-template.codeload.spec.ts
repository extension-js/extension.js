import AdmZip from 'adm-zip'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {afterEach, describe, expect, it} from 'vitest'
import {
  extractExamplesTemplateFromZip,
  TemplateNotFoundError
} from '../import-external-template'

const tempDirs: string[] = []
afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, {recursive: true, force: true})
  }
})

function makeProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-codeload-'))
  tempDirs.push(dir)
  return dir
}

// Mirror a GitHub codeload zip: everything under a single `examples-main/` root,
// templates under `examples-main/examples/<slug>/`.
function makeExamplesZip(): Buffer {
  const zip = new AdmZip()
  zip.addFile('examples-main/README.md', Buffer.from('# examples'))
  zip.addFile(
    'examples-main/examples/react/package.json',
    Buffer.from('{"name":"react"}')
  )
  zip.addFile(
    'examples-main/examples/react/src/index.tsx',
    Buffer.from('export const App = () => null')
  )
  zip.addFile(
    'examples-main/examples/react/template.meta.json',
    Buffer.from('{"featured":true}')
  )
  zip.addFile(
    'examples-main/examples/vue/package.json',
    Buffer.from('{"name":"vue"}')
  )
  return zip.toBuffer()
}

describe('extractExamplesTemplateFromZip (#56, per-template subtree extraction)', () => {
  it('unpacks only the requested template, rooted at the project dir', async () => {
    const project = makeProject()
    const written = await extractExamplesTemplateFromZip(
      makeExamplesZip(),
      'react',
      project
    )

    expect(written).toBe(3)
    // Files land at the project root, NOT under examples/react/.
    expect(fs.existsSync(path.join(project, 'package.json'))).toBe(true)
    expect(fs.existsSync(path.join(project, 'src', 'index.tsx'))).toBe(true)
    expect(
      JSON.parse(fs.readFileSync(path.join(project, 'package.json'), 'utf8'))
        .name
    ).toBe('react')
    // A DIFFERENT template's files must not leak in.
    expect(fs.existsSync(path.join(project, 'vue'))).toBe(false)
    expect(fs.readdirSync(project)).not.toContain('examples')
  })

  it('throws TemplateNotFoundError for a slug absent from the archive', async () => {
    const project = makeProject()
    await expect(
      extractExamplesTemplateFromZip(makeExamplesZip(), 'svelte', project)
    ).rejects.toBeInstanceOf(TemplateNotFoundError)
  })

  it('throws TemplateNotFoundError (not a crash) on an empty archive', async () => {
    const project = makeProject()
    const empty = new AdmZip().toBuffer()
    await expect(
      extractExamplesTemplateFromZip(empty, 'react', project)
    ).rejects.toBeInstanceOf(TemplateNotFoundError)
  })
})
