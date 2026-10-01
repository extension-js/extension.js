import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {findPublicFile, publicRelativePath} from '../resolve-public-folder'

const created: string[] = []

function project(files: string[]) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-find-public-'))
  )
  created.push(root)

  for (const file of files) {
    const abs = path.join(root, file)
    fs.mkdirSync(path.dirname(abs), {recursive: true})
    fs.writeFileSync(abs, 'x')
  }

  return {root, manifest: path.join(root, 'src', 'manifest.json')}
}

afterEach(() => {
  for (const dir of created.splice(0)) {
    fs.rmSync(dir, {recursive: true, force: true})
  }
})

describe('publicRelativePath', () => {
  it('strips every public spelling down to the path inside the folder', () => {
    expect(publicRelativePath('/public/icons/a.png')).toBe('icons/a.png')
    expect(publicRelativePath('public/icons/a.png')).toBe('icons/a.png')
    expect(publicRelativePath('./public/icons/a.png')).toBe('icons/a.png')
    expect(publicRelativePath('/icons/a.png')).toBe('icons/a.png')
    expect(publicRelativePath('./icons/a.png')).toBe('icons/a.png')
    expect(publicRelativePath('icons\\a.png')).toBe('icons/a.png')
  })
})

describe('findPublicFile', () => {
  it('finds a file in the project-root public/ for a src/ manifest', () => {
    const {root, manifest} = project([
      'src/manifest.json',
      'public/icons/a.png'
    ])
    expect(findPublicFile(manifest, root, 'icons/a.png')).toBe(
      path.join(root, 'public', 'icons', 'a.png')
    )

    expect(findPublicFile(manifest, root, '/icons/a.png')).toBe(
      path.join(root, 'public', 'icons', 'a.png')
    )

    expect(findPublicFile(manifest, root, 'public/icons/a.png')).toBe(
      path.join(root, 'public', 'icons', 'a.png')
    )
  })

  it('falls back to the next-to-manifest public/', () => {
    const {root, manifest} = project([
      'src/manifest.json',
      'src/public/icons/a.png'
    ])
    expect(findPublicFile(manifest, root, 'icons/a.png')).toBe(
      path.join(root, 'src', 'public', 'icons', 'a.png')
    )
  })

  it('lets the project root win when both folders have the file', () => {
    const {root, manifest} = project([
      'src/manifest.json',
      'public/a.png',
      'src/public/a.png'
    ])
    expect(findPublicFile(manifest, root, 'a.png')).toBe(
      path.join(root, 'public', 'a.png')
    )
  })

  it('answers undefined for a missing file, a folder or a path that escapes', () => {
    const {root, manifest} = project([
      'src/manifest.json',
      'public/icons/a.png'
    ])
    expect(findPublicFile(manifest, root, 'icons/b.png')).toBeUndefined()
    expect(findPublicFile(manifest, root, 'icons')).toBeUndefined()
    expect(
      findPublicFile(manifest, root, '../public/icons/a.png')
    ).toBeUndefined()

    expect(findPublicFile(manifest, root, '')).toBeUndefined()
  })

  it('uses the manifest folder alone when no project root is known', () => {
    const {manifest, root} = project(['src/manifest.json', 'src/public/a.png'])
    expect(findPublicFile(manifest, undefined, 'a.png')).toBe(
      path.join(root, 'src', 'public', 'a.png')
    )
  })
})
