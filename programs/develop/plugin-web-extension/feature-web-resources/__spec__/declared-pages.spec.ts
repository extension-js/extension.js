import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {discoverWebAccessiblePages} from '../web-resources-lib/declared-pages'

const created: string[] = []

function project(manifest: unknown, files: Record<string, string>) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'war-declared-pages-'))
  )
  created.push(root)

  const all = {'src/manifest.json': JSON.stringify(manifest), ...files}

  for (const [rel, content] of Object.entries(all)) {
    const abs = path.join(root, rel)
    fs.mkdirSync(path.dirname(abs), {recursive: true})
    fs.writeFileSync(abs, content)
  }

  return {root, manifestPath: path.join(root, 'src', 'manifest.json')}
}

afterEach(() => {
  for (const dir of created.splice(0)) {
    fs.rmSync(dir, {recursive: true, force: true})
  }
})

describe('pages the web_accessible_resources list names', () => {
  it('enters a source page beside the manifest and one the root owns', () => {
    const {root, manifestPath} = project(
      {
        manifest_version: 3,
        web_accessible_resources: [
          {
            matches: ['<all_urls>'],
            resources: ['inner/beside.html', '../frames/above.html']
          }
        ]
      },
      {
        'src/inner/beside.html': '<html></html>',
        'frames/above.html': '<html></html>'
      }
    )

    expect(discoverWebAccessiblePages(manifestPath, 'chrome', root)).toEqual({
      'inner/beside': path.join(root, 'src', 'inner', 'beside.html'),
      'frames/above': path.join(root, 'frames', 'above.html')
    })
  })

  it('reads the plain string entries of a version 2 manifest', () => {
    const {root, manifestPath} = project(
      {manifest_version: 2, web_accessible_resources: ['frame.html']},
      {'src/frame.html': '<html></html>'}
    )

    expect(discoverWebAccessiblePages(manifestPath, 'firefox', root)).toEqual({
      frame: path.join(root, 'src', 'frame.html')
    })
  })

  it('enters nothing for a glob, a public file, a missing file or another type', () => {
    const {root, manifestPath} = project(
      {
        manifest_version: 3,
        web_accessible_resources: [
          {
            matches: ['<all_urls>'],
            resources: [
              'inner/*.html',
              'hosted.html',
              '/rooted.html',
              'missing.html',
              'inner/data.json',
              'inner/legacy.htm'
            ]
          }
        ]
      },
      {
        'src/inner/one.html': '<html></html>',
        'src/inner/data.json': '{}',
        'src/inner/legacy.htm': '<html></html>',
        'public/hosted.html': '<html></html>',
        'public/rooted.html': '<html></html>'
      }
    )

    expect(discoverWebAccessiblePages(manifestPath, 'chrome', root)).toEqual({})
  })

  it('reads the list a browser prefix carries for that browser only', () => {
    const {root, manifestPath} = project(
      {
        manifest_version: 3,
        'firefox:web_accessible_resources': [
          {matches: ['<all_urls>'], resources: ['gecko.html']}
        ]
      },
      {'src/gecko.html': '<html></html>'}
    )

    expect(discoverWebAccessiblePages(manifestPath, 'firefox', root)).toEqual({
      gecko: path.join(root, 'src', 'gecko.html')
    })

    expect(discoverWebAccessiblePages(manifestPath, 'chrome', root)).toEqual({})
  })
})
