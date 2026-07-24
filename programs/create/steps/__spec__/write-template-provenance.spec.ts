import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {
  buildProvenanceRecord,
  TEMPLATE_PROVENANCE_FILE,
  writeTemplateProvenance
} from '../write-template-provenance'

const silent = {log() {}, error() {}}
const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, {recursive: true, force: true})
  }
})

function makeProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-prov-'))
  tempDirs.push(dir)
  return dir
}

describe('writeTemplateProvenance (.extension-create.json)', () => {
  it('stamps template, ref, and source for a catalog scaffold', async () => {
    const project = makeProject()
    await writeTemplateProvenance(
      project,
      {
        template: 'react',
        source:
          'https://codeload.github.com/extension-js/examples/zip/refs/heads/main',
        ref: 'main'
      },
      silent
    )

    const file = path.join(project, TEMPLATE_PROVENANCE_FILE)
    expect(fs.existsSync(file)).toBe(true)
    const record = JSON.parse(fs.readFileSync(file, 'utf8'))
    expect(record.template).toBe('react')
    expect(record.ref).toBe('main')
    expect(record.source).toContain('refs/heads/main')
  })

  it('records a pinned commit SHA verbatim in the source', async () => {
    const project = makeProject()
    const sha = '2d2ed9668cca002148d9eecd953a08b54d0bad9d'
    await writeTemplateProvenance(
      project,
      {
        template: 'action',
        source: `https://codeload.github.com/extension-js/examples/zip/${sha}`,
        ref: sha
      },
      silent
    )
    const record = JSON.parse(
      fs.readFileSync(path.join(project, TEMPLATE_PROVENANCE_FILE), 'utf8')
    )
    expect(record.ref).toBe(sha)
    expect(record.source.endsWith(sha)).toBe(true)
  })

  it('omits ref for a bundled or URL-override source', () => {
    expect(
      buildProvenanceRecord({template: 'javascript', source: 'bundled'})
    ).not.toHaveProperty('ref')

    const override = buildProvenanceRecord({
      template: 'action',
      source: 'https://media.extension.land/templates/2d2ed966/action.zip'
    })
    expect(override).not.toHaveProperty('ref')
    expect(override.source).toContain('media.extension.land')
  })

  it('is advisory: never throws when the target dir is unwritable', async () => {
    const missing = path.join(os.tmpdir(), 'extjs-prov-missing-xyz', 'nested')
    await expect(
      writeTemplateProvenance(
        missing,
        {template: 'react', source: 'bundled'},
        silent
      )
    ).resolves.toBeUndefined()
  })
})
