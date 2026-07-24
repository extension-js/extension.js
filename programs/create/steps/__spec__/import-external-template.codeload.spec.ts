import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import AdmZip from 'adm-zip'
import {afterEach, describe, expect, it} from 'vitest'
import {
  extractExamplesTemplateFromZip,
  resolveCatalogUrls,
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
    expect(fs.existsSync(path.join(project, 'package.json'))).toBe(true)
    expect(fs.existsSync(path.join(project, 'src', 'index.tsx'))).toBe(true)
    expect(
      JSON.parse(fs.readFileSync(path.join(project, 'package.json'), 'utf8'))
        .name
    ).toBe('react')
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

describe('resolveCatalogUrls (EXTENSION_CREATE_TEMPLATE_REF -> codeload namespace)', () => {
  const BASE = 'https://codeload.github.com/extension-js/examples/zip'

  it('serves a bare branch from refs/heads first, tag as fallback', () => {
    expect(resolveCatalogUrls('main')).toEqual([
      `${BASE}/refs/heads/main`,
      `${BASE}/refs/tags/main`
    ])
  })

  it('pins a full 40-hex commit SHA at /zip/<sha> only', () => {
    const sha = '2d2ed9668cca002148d9eecd953a08b54d0bad9d'
    expect(resolveCatalogUrls(sha)).toEqual([`${BASE}/${sha}`])
  })

  it('detects an uppercase SHA too', () => {
    const sha = '2D2ED9668CCA002148D9EECD953A08B54D0BAD9D'
    expect(resolveCatalogUrls(sha)).toEqual([`${BASE}/${sha}`])
  })

  it('tries a short hex ref as a commit first, then branch/tag', () => {
    expect(resolveCatalogUrls('2d2ed96')).toEqual([
      `${BASE}/2d2ed96`,
      `${BASE}/refs/heads/2d2ed96`,
      `${BASE}/refs/tags/2d2ed96`
    ])
  })

  it('resolves a non-hex tag name via branch-then-tag fallback', () => {
    expect(resolveCatalogUrls('v1.2.0')).toEqual([
      `${BASE}/refs/heads/v1.2.0`,
      `${BASE}/refs/tags/v1.2.0`
    ])
  })

  it('honors a fully-qualified refs/tags/ ref verbatim', () => {
    expect(resolveCatalogUrls('refs/tags/v1.2.0')).toEqual([
      `${BASE}/refs/tags/v1.2.0`
    ])
  })

  it('honors a fully-qualified refs/heads/ ref verbatim', () => {
    expect(resolveCatalogUrls('refs/heads/next')).toEqual([
      `${BASE}/refs/heads/next`
    ])
  })

  it('lets a full override URL win outright, ignoring the ref', () => {
    const override =
      'https://media.extension.land/templates/2d2ed966/examples.zip'
    expect(resolveCatalogUrls('main', override)).toEqual([override])
  })
})
