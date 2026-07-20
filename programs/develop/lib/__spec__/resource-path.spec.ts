import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {
  canonicalizeDir,
  canonicalizeResourcePath,
  isResourceUnderDirs,
  toResourceKey
} from '../resource-path'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, {recursive: true, force: true})
  }
})

// Build a project whose real source dir is also reachable through a symlinked
// ancestor. Resolving the symlinked form vs the real form is the SAME class of
// divergence that breaks the content-script wrapper on Windows (native realpath
// expands 8.3 short names / drive case), but reproducible on every OS. A
// directory junction is used so Windows CI can create it without elevation.
function makeProjectWithSymlinkedView() {
  const root = fs.realpathSync(
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
    // The directory is canonicalized even though the file is absent.
    expect(canonicalizeResourcePath(virtual)).toBe(
      path.join(canonicalizeDir(contentDir), 'does-not-exist.ts')
    )
  })

  it('isResourceUnderDirs matches a resource referenced via a symlinked ancestor', () => {
    const {realSrc, linkedResource} = makeProjectWithSymlinkedView()
    const includeDirs = [canonicalizeDir(realSrc)]

    // The helper canonicalizes both sides, so containment holds...
    expect(isResourceUnderDirs(linkedResource, includeDirs)).toBe(true)
    // ...whereas a naive prefix check (the old behavior) would NOT, because the
    // symlinked path string is not a prefix of the real include dir.
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

    // `src-extra/a.ts` must NOT count as being under `src/` even though the
    // string `.../src` is a prefix of `.../src-extra`.
    expect(isResourceUnderDirs(fileInSibling, [canonicalizeDir(dir)])).toBe(
      false
    )
  })

  it('isResourceUnderDirs rejects empty/non-string input', () => {
    expect(isResourceUnderDirs('', ['/x'])).toBe(false)
    expect(isResourceUnderDirs(undefined as any, ['/x'])).toBe(false)
  })

  it('toResourceKey yields one key for every absolute form of the same path', () => {
    // On Windows `path.normalize('/project/sw.js')` stays drive-less
    // (`\project\sw.js`) while `path.resolve` prepends the cwd drive, the
    // exact divergence that made a resolve-built set unmatchable by a
    // normalize-built probe. On POSIX the forms coincide, so this assertion
    // is only load-bearing on the Windows runner.
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
    expect(toResourceKey(undefined as any)).toBe(undefined)
  })
})
