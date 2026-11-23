import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {
  canonicalizeDir,
  canonicalizeResourcePath,
  forgetResolvedModuleFolders,
  isResourceUnderDirs,
  toProjectRelativePath,
  toResourceKey
} from '../resource-path'

const tempDirs: string[] = []

afterEach(() => {
  for (const tempFolder of tempDirs.splice(0)) {
    fs.rmSync(tempFolder, {recursive: true, force: true})
  }
})

function makeProjectWithSymlinkedView() {
  // The native form also expands a Windows short name such as RUNNER~1,
  // which is the form the code under test answers with.
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-rp-'))
  )
  tempDirs.push(root)
  const realSrc = path.join(root, 'real-src')
  const contentDir = path.join(realSrc, 'content')
  fs.mkdirSync(contentDir, {recursive: true})
  const realResource = path.join(contentDir, 'scripts.ts')
  fs.writeFileSync(realResource, 'export default function m(){}\n')

  const linkedSrc = path.join(root, 'linked-src')
  fs.symlinkSync(realSrc, linkedSrc, 'junction')
  const linkedResource = path.join(linkedSrc, 'content', 'scripts.ts')

  return {root, realSrc, realResource, linkedResource, contentDir}
}

describe('lib/resource-path', () => {
  it('canonicalizeResourcePath resolves a symlinked ancestor to the real form', () => {
    const {realResource, linkedResource} = makeProjectWithSymlinkedView()
    expect(canonicalizeResourcePath(linkedResource)).toBe(
      canonicalizeResourcePath(realResource)
    )
  })

  it('canonicalizeResourcePath tolerates a virtual file whose directory exists', () => {
    const {contentDir} = makeProjectWithSymlinkedView()
    const virtual = path.join(contentDir, 'does-not-exist.ts')
    expect(canonicalizeResourcePath(virtual)).toBe(
      path.join(canonicalizeDir(contentDir), 'does-not-exist.ts')
    )
  })

  it('isResourceUnderDirs matches a resource referenced via a symlinked ancestor', () => {
    const {realSrc, linkedResource} = makeProjectWithSymlinkedView()
    const includeDirs = [canonicalizeDir(realSrc)]

    expect(isResourceUnderDirs(linkedResource, includeDirs)).toBe(true)
    expect(linkedResource.startsWith(includeDirs[0])).toBe(false)
  })

  it('isResourceUnderDirs does not over-match a sibling-prefix directory', () => {
    const root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-rp2-'))
    )
    tempDirs.push(root)
    const dir = path.join(root, 'src')
    const sibling = path.join(root, 'src-extra')
    fs.mkdirSync(dir, {recursive: true})
    fs.mkdirSync(sibling, {recursive: true})
    const fileInSibling = path.join(sibling, 'a.ts')
    fs.writeFileSync(fileInSibling, 'x')

    expect(isResourceUnderDirs(fileInSibling, [canonicalizeDir(dir)])).toBe(
      false
    )
  })

  it('isResourceUnderDirs rejects empty/non-string input', () => {
    expect(isResourceUnderDirs('', ['/x'])).toBe(false)
    expect(isResourceUnderDirs(undefined as unknown as string, ['/x'])).toBe(
      false
    )
  })

  it('toResourceKey yields one key for every absolute form of the same path', () => {
    const forms = [
      '/project/sw.js',
      '/project/./sw.js',
      '/project/sub/../sw.js',
      path.normalize('/project/sw.js'),
      path.resolve('/project/sw.js')
    ]
    const keys = new Set(forms.map(toResourceKey))
    expect(keys.size).toBe(1)
  })

  it('toResourceKey agrees across symlinked and real views of an existing file', () => {
    const {realResource, linkedResource} = makeProjectWithSymlinkedView()
    expect(toResourceKey(linkedResource)).toBe(toResourceKey(realResource))
  })

  it('toResourceKey folds drive-letter case on Windows', () => {
    if (process.platform !== 'win32') return

    const upper = toResourceKey('C:\\project\\sw.js')
    const lower = toResourceKey('c:\\project\\sw.js')
    expect(upper).toBe(lower)
    expect(upper.startsWith('C:')).toBe(true)
  })

  it('toResourceKey passes through empty/non-string input', () => {
    expect(toResourceKey('')).toBe('')
    expect(toResourceKey(undefined as unknown as string)).toBe(undefined)
  })

  it('reads a module folder from disk once for all the files in it', () => {
    const {realSrc, contentDir, linkedResource} = makeProjectWithSymlinkedView()
    const includeDirs = [canonicalizeDir(realSrc)]
    const files = Array.from({length: 500}, (_, index) =>
      path.join(path.dirname(linkedResource), `module-${index}.ts`)
    )

    forgetResolvedModuleFolders()
    const realpath = vi.spyOn(fs.realpathSync, 'native')

    try {
      // Three rules ask about every module, the way a build does.
      for (let rule = 0; rule < 3; rule++) {
        for (const file of files) {
          expect(isResourceUnderDirs(file, includeDirs)).toBe(true)
          expect(toResourceKey(file).startsWith(contentDir)).toBe(true)
        }
      }

      expect(realpath).toHaveBeenCalledTimes(1)
    } finally {
      realpath.mockRestore()
    }
  })

  it('reads a folder again after the next build starts', () => {
    const {root, realSrc} = makeProjectWithSymlinkedView()
    const otherSrc = path.join(root, 'other-src')
    fs.mkdirSync(path.join(otherSrc, 'content'), {recursive: true})
    const moving = path.join(root, 'moving-src')
    const resource = path.join(moving, 'content', 'scripts.ts')

    fs.symlinkSync(realSrc, moving, 'junction')
    forgetResolvedModuleFolders()
    expect(canonicalizeResourcePath(resource)).toBe(
      path.join(realSrc, 'content', 'scripts.ts')
    )

    fs.rmSync(moving, {recursive: true, force: true})
    fs.symlinkSync(otherSrc, moving, 'junction')
    forgetResolvedModuleFolders()
    expect(canonicalizeResourcePath(resource)).toBe(
      path.join(otherSrc, 'content', 'scripts.ts')
    )
  })

  it('does not remember a folder that is missing', () => {
    const {root} = makeProjectWithSymlinkedView()
    const later = path.join(root, 'later')
    const target = path.join(root, 'real-src', 'content')
    const resource = path.join(later, 'scripts.ts')

    forgetResolvedModuleFolders()
    expect(canonicalizeResourcePath(resource)).toBe(resource)

    fs.symlinkSync(target, later, 'junction')
    expect(canonicalizeResourcePath(resource)).toBe(
      path.join(target, 'scripts.ts')
    )
  })
})

describe('toProjectRelativePath', () => {
  it('names a file under the project by its path from the root', () => {
    const {root, realResource} = makeProjectWithSymlinkedView()

    expect(toProjectRelativePath(root, realResource)).toBe(
      'real-src/content/scripts.ts'
    )
  })

  it('reads a symlinked view of the file as the same path', () => {
    const {realSrc, linkedResource} = makeProjectWithSymlinkedView()

    expect(toProjectRelativePath(realSrc, linkedResource)).toBe(
      'content/scripts.ts'
    )
  })

  it('names a file behind a linked folder by the path as given', () => {
    const {root, linkedResource} = makeProjectWithSymlinkedView()
    const project = path.join(root, 'linked-src')
    const elsewhere = path.join(root, 'elsewhere')

    fs.mkdirSync(elsewhere)
    fs.symlinkSync(elsewhere, path.join(root, 'real-src', 'far'), 'junction')

    expect(toProjectRelativePath(root, linkedResource)).toBe(
      'linked-src/content/scripts.ts'
    )

    expect(
      toProjectRelativePath(project, path.join(project, 'far', 'a.png'))
    ).toBe('far/a.png')
  })

  it('names a file whose name opens with two dots', () => {
    const {root} = makeProjectWithSymlinkedView()

    expect(toProjectRelativePath(root, path.join(root, '..env'))).toBe('..env')
    expect(toProjectRelativePath(root, path.join(root, '..'))).toBe(
      path.join(root, '..')
    )
  })

  it('leaves a file outside the project as given', () => {
    const {contentDir, realResource} = makeProjectWithSymlinkedView()
    const outside = path.join(path.dirname(contentDir), 'other.css')

    expect(toProjectRelativePath(contentDir, outside)).toBe(outside)
    expect(toProjectRelativePath(undefined, realResource)).toBe(realResource)
  })
})
