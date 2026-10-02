import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {
  DEFAULT_TEMPLATE_NAME,
  importExternalTemplate
} from '../steps/import-external-template'

const noopLogger = {log() {}, error() {}}

describe('the pinned examples catalog still serves the default template', () => {
  let workDir = ''

  beforeEach(async () => {
    workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'extjs-catalog-'))
  })

  afterEach(async () => {
    await fsp.rm(workDir, {recursive: true, force: true})
  })

  it('downloads it from codeload and records the pinned ref', async () => {
    const projectPath = path.join(workDir, 'from-catalog')

    const provenance = await importExternalTemplate(
      projectPath,
      'from-catalog',
      DEFAULT_TEMPLATE_NAME,
      noopLogger
    )

    expect(provenance.template).toBe(DEFAULT_TEMPLATE_NAME)
    expect(provenance.source).toContain('codeload.github.com')
    expect(provenance.ref).toBeTruthy()
    await expect(
      fsp.readFile(path.join(projectPath, 'package.json'), 'utf8')
    ).resolves.toContain('"name"')
  }, 600_000)
})
