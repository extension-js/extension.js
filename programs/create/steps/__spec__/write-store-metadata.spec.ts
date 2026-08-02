import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {rewriteStoreMetadata, writeStoreMetadata} from '../write-store-metadata'

const TEMPLATE_STORE_MD = [
  '# Store metadata',
  '',
  "Starter file generated from this template's manifest.",
  '',
  'Last updated: 2026-07-20',
  '',
  '## Listing',
  '',
  '- Name: JavaScript Sidebar Example',
  '- Summary: JavaScript-based extension with a sidebar panel.',
  '',
  '## Version history',
  '',
  '- 1.0.0 (unreleased): initial version of JavaScript Sidebar Example.',
  ''
].join('\n')

describe('rewriteStoreMetadata', () => {
  it('replaces the listing name with the project name', () => {
    const output = rewriteStoreMetadata(
      TEMPLATE_STORE_MD,
      'my-extension',
      'JavaScript Sidebar Example',
      '2026-07-30'
    )
    expect(output).toMatch(/^- Name: my-extension$/m)
  })

  it('replaces every other mention of the template name', () => {
    const output = rewriteStoreMetadata(
      TEMPLATE_STORE_MD,
      'my-extension',
      'JavaScript Sidebar Example',
      '2026-07-30'
    )
    expect(output).not.toContain('JavaScript Sidebar Example')
    expect(output).toContain('initial version of my-extension')
  })

  it('dates the file the day the scaffold was written', () => {
    const output = rewriteStoreMetadata(
      TEMPLATE_STORE_MD,
      'my-extension',
      'JavaScript Sidebar Example',
      '2026-07-30'
    )
    expect(output).toContain('Last updated: 2026-07-30')
  })

  it('treats a template name with regex characters as text', () => {
    const output = rewriteStoreMetadata(
      '- Name: A (Fancy) Example\nBuilt by A (Fancy) Example.\n',
      'my-extension',
      'A (Fancy) Example',
      '2026-07-30'
    )
    expect(output).toContain('Built by my-extension.')
  })

  it('renames once when the project name extends the template name', () => {
    const content = [
      '- Name: New Tab',
      'A better New Tab for your browser.',
      'Last updated: 2026-07-20',
      '- 1.0.0 (unreleased): initial version of New Tab.',
      ''
    ].join('\n')

    const output = rewriteStoreMetadata(
      content,
      'New Tab Pro',
      'New Tab',
      '2026-07-30'
    )

    expect(output).toMatch(/^- Name: New Tab Pro$/m)
    expect(output).toContain('A better New Tab Pro for your browser.')
    expect(output).toContain('initial version of New Tab Pro.')
    expect(output).not.toContain('New Tab Pro Pro')
  })

  it('renames normally when the names do not overlap', () => {
    const output = rewriteStoreMetadata(
      TEMPLATE_STORE_MD,
      'totally-unrelated',
      'JavaScript Sidebar Example',
      '2026-07-30'
    )

    expect(output).toMatch(/^- Name: totally-unrelated$/m)
    expect(output).not.toContain('JavaScript Sidebar Example')
    expect(output).toContain('initial version of totally-unrelated.')
  })

  it('leaves the file alone when the template already carries the name', () => {
    const same = '- Name: my-extension\nLast updated: 2026-07-30\n'
    expect(
      rewriteStoreMetadata(same, 'my-extension', 'my-extension', '2026-07-30')
    ).toBe(same)
  })
})

describe('writeStoreMetadata', () => {
  it('does nothing when the template ships no STORE.md', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'extjs-create-store-'))
    try {
      await expect(
        writeStoreMetadata(dir, 'my-extension', 'Whatever', console)
      ).resolves.toBeUndefined()
      await expect(fs.readdir(dir)).resolves.toEqual([])
    } finally {
      await fs.rm(dir, {recursive: true, force: true})
    }
  })

  it('rewrites the file in place', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'extjs-create-store-'))
    try {
      await fs.writeFile(path.join(dir, 'STORE.md'), TEMPLATE_STORE_MD)
      await writeStoreMetadata(
        dir,
        'my-extension',
        'JavaScript Sidebar Example',
        console
      )
      const written = await fs.readFile(path.join(dir, 'STORE.md'), 'utf8')
      expect(written).toMatch(/^- Name: my-extension$/m)
      expect(written).not.toContain('JavaScript Sidebar Example')
    } finally {
      await fs.rm(dir, {recursive: true, force: true})
    }
  })
})
