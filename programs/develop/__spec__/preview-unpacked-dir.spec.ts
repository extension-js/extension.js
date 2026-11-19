import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {
  explicitUnpackedDir,
  extensionPreview,
  previewArchiveTarget
} from '../command-preview'
import {remoteArchiveCacheRoot} from '../lib/remote-archive'

const created: string[] = []

function tree(layout: Record<string, string>) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-preview-unpacked-'))
  )
  created.push(root)

  for (const [rel, content] of Object.entries(layout)) {
    const abs = path.join(root, rel)
    fs.mkdirSync(path.dirname(abs), {recursive: true})
    fs.writeFileSync(abs, content)
  }

  return root
}

afterEach(() => {
  vi.restoreAllMocks()

  for (const dir of created.splice(0)) {
    fs.rmSync(dir, {recursive: true, force: true})
  }
})

const MANIFEST = JSON.stringify({
  manifest_version: 3,
  name: 'named-folder',
  version: '1.0.0'
})

// What a preview with no browser says about the folder it was pointed at.
async function previewWarnings(target: string | undefined) {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

  const result = await extensionPreview(target, {
    browser: 'chrome',
    noBrowser: true
  } as never)

  return {
    returned: result?.warnings ?? [],
    printed: warn.mock.calls.map((call) => String(call[0])).join('\n')
  }
}

describe('explicitUnpackedDir', () => {
  it('treats a manifest folder under an ancestor project as the extension', () => {
    const root = tree({
      'package.json': '{"name":"repo"}',
      'build/firefox/manifest.json': '{}'
    })
    const typed = path.join(root, 'build', 'firefox')

    expect(explicitUnpackedDir(typed, root)).toBe(typed)
  })

  it('leaves a project root, a src/ folder and a remote url to the normal path', () => {
    const root = tree({
      'package.json': '{"name":"app"}',
      'manifest.json': '{}',
      'src/manifest.json': '{}'
    })

    expect(explicitUnpackedDir(root, root)).toBeUndefined()
    expect(explicitUnpackedDir(path.join(root, 'src'), root)).toBeUndefined()
    expect(
      explicitUnpackedDir('https://example.com/ext.zip', root)
    ).toBeUndefined()

    expect(explicitUnpackedDir(undefined, root)).toBeUndefined()
  })

  it('answers nothing for a folder without a manifest', () => {
    const root = tree({'package.json': '{"name":"repo"}', 'build/x.js': ''})

    expect(explicitUnpackedDir(path.join(root, 'build'), root)).toBeUndefined()
  })
})

describe('previewArchiveTarget', () => {
  it('sends a previewed archive to the cache', () => {
    expect(previewArchiveTarget('preview')).toEqual({
      cacheRoot: remoteArchiveCacheRoot()
    })
  })

  it('sends it to --output-path when one is given', () => {
    expect(previewArchiveTarget('preview', 'unpacked/here')).toEqual({
      destination: path.resolve(process.cwd(), 'unpacked/here')
    })
  })

  it('leaves start on the current directory', () => {
    expect(previewArchiveTarget('start')).toBeUndefined()
    expect(previewArchiveTarget('start', 'unpacked/here')).toBeUndefined()
  })
})

describe('a folder named on the command line that holds the manifest', () => {
  it('is the build when the project above it does not depend on Extension.js', async () => {
    const root = tree({
      'package.json': '{"name":"repo","private":true}',
      'dist/chrome/manifest.json': MANIFEST
    })
    const {returned, printed} = await previewWarnings(
      path.join(root, 'dist', 'chrome')
    )

    expect(returned).toEqual([])
    expect(printed).not.toContain('No production build found')
  })

  it('is the build when nothing above it is a project at all', async () => {
    const root = tree({'unpacked/manifest.json': MANIFEST})
    const {returned, printed} = await previewWarnings(
      path.join(root, 'unpacked')
    )

    expect(returned).toEqual([])
    expect(printed).not.toContain('No production build found')
  })

  it('still previews the build under it when there is one', async () => {
    const root = tree({
      'plain/manifest.json': MANIFEST,
      'plain/dist/chrome/manifest.json': MANIFEST
    })
    const {returned} = await previewWarnings(path.join(root, 'plain'))
    const ready = JSON.parse(
      fs.readFileSync(
        path.join(
          root,
          'plain',
          'dist',
          'extension-js',
          'chrome',
          'ready.json'
        ),
        'utf-8'
      )
    )

    expect(returned).toEqual([])
    expect(ready.distPath).toBe(path.join(root, 'plain', 'dist', 'chrome'))
  })

  it('keeps the warning for a project that has no build yet', async () => {
    const root = tree({
      'package.json': '{"name":"app","private":true}',
      'manifest.json': MANIFEST
    })
    const {returned, printed} = await previewWarnings(root)

    expect(returned).toHaveLength(1)
    expect(printed).toContain(
      `No production build found at ${path.join(root, 'dist', 'chrome')}`
    )
  })

  it('keeps the warning for a src folder, which is source', async () => {
    const root = tree({
      'package.json': '{"name":"repo","private":true}',
      'app/src/manifest.json': MANIFEST
    })
    const {returned} = await previewWarnings(path.join(root, 'app', 'src'))

    expect(returned).toHaveLength(1)
  })
})
