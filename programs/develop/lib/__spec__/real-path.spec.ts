import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import {
  createPathComparisons,
  isInsidePath,
  isOsPathUnder,
  isSameOrInsidePath,
  isSamePath,
  realPath
} from '../real-path'

const makeTempFolder = trackTempFolders()

function linkedPair(): {real: string; linked: string} | undefined {
  const base = fs.realpathSync(makeTempFolder('extjs-real-path-'))
  const real = path.join(base, 'real')
  const linked = path.join(base, 'linked')

  fs.mkdirSync(path.join(real, 'src'), {recursive: true})
  fs.writeFileSync(path.join(real, 'src', 'a.js'), '')

  try {
    fs.symlinkSync(real, linked, 'dir')
  } catch {
    return undefined
  }

  return {real, linked}
}

const pair = linkedPair()

describe('path comparisons as given', () => {
  const root = path.join(path.sep, 'work', 'project')

  it('tells same, inside and outside apart without touching the disk', () => {
    expect(isSamePath(root, root)).toBe(true)
    expect(isSamePath(root, path.join(root, 'src'))).toBe(false)

    expect(isInsidePath(root, path.join(root, 'src', 'a.js'))).toBe(true)
    expect(isInsidePath(root, root)).toBe(false)
    expect(isSameOrInsidePath(root, root)).toBe(true)

    // A sibling that only starts with the same letters is not inside.
    expect(isInsidePath(root, `${root}-other`)).toBe(false)
    expect(isInsidePath(root, path.join(root, '..', 'elsewhere'))).toBe(false)
    expect(isSameOrInsidePath(root, path.dirname(root))).toBe(false)
  })

  it('answers no for an empty side', () => {
    expect(isSamePath('', root)).toBe(false)
    expect(isInsidePath('', root)).toBe(false)
    expect(isSameOrInsidePath(root, '')).toBe(false)
    expect(isOsPathUnder('', root)).toBe(false)
  })

  it('keeps a reference from the project root apart from a path on disk', () => {
    expect(isOsPathUnder(root, '/img/logo.png')).toBe(false)
    expect(isOsPathUnder(root, path.join(root, 'img', 'logo.png'))).toBe(true)
  })
})

describe.skipIf(!pair)('path comparisons across a linked folder', () => {
  const {real, linked} = pair as {real: string; linked: string}
  // The comparing spelling. On Windows it also spells a short name out.
  const spelled = fs.realpathSync.native(real)

  it('resolves a path that exists, and one that does not through its parent', () => {
    expect(realPath(path.join(linked, 'src', 'a.js'))).toBe(
      path.join(spelled, 'src', 'a.js')
    )

    expect(realPath(path.join(linked, 'public', 'later.json'))).toBe(
      path.join(spelled, 'public', 'later.json')
    )
  })

  it('sees one folder under both spellings', () => {
    expect(isSamePath(linked, real)).toBe(true)
    expect(isSamePath(path.join(linked, 'dist'), path.join(real, 'dist'))).toBe(
      true
    )

    expect(isSameOrInsidePath(linked, real)).toBe(true)
    expect(isInsidePath(linked, real)).toBe(false)
  })

  it('finds a path inside whichever side is linked', () => {
    expect(isInsidePath(linked, path.join(real, 'src', 'a.js'))).toBe(true)
    expect(isInsidePath(real, path.join(linked, 'src', 'a.js'))).toBe(true)
    expect(isInsidePath(linked, path.join(real, 'not', 'there', 'yet'))).toBe(
      true
    )

    expect(isInsidePath(linked, path.dirname(real))).toBe(false)
    expect(isOsPathUnder(linked, path.join(real, 'src', 'a.js'))).toBe(true)
  })

  it('sees a folder that appears after it was first asked about', () => {
    const later = path.join(linked, 'appears')

    expect(isSamePath(later, path.join(real, 'appears'))).toBe(true)
    fs.mkdirSync(path.join(real, 'appears'))
    expect(isSamePath(later, path.join(real, 'appears'))).toBe(true)
    expect(realPath(later)).toBe(path.join(spelled, 'appears'))
  })
})

describe('path comparisons across a short name', () => {
  const users = path.join(path.sep, 'Users')
  const short = path.join(users, 'RUNNER~1', 'Temp', 'project')
  const long = path.join(users, 'runneradmin', 'Temp', 'project')
  // Stands in for Windows, where the real path spells a short name out.
  const {isInsidePath, isSameOrInsidePath, isSamePath, realPath} =
    createPathComparisons((target) =>
      target
        .split(path.sep)
        .map((part) => (part === 'RUNNER~1' ? 'runneradmin' : part))
        .join(path.sep)
    )

  it('sees one folder under the short and the long spelling', () => {
    expect(isSamePath(short, long)).toBe(true)
    expect(isSameOrInsidePath(long, short)).toBe(true)
    expect(isInsidePath(short, long)).toBe(false)
  })

  it('finds a path inside whichever side is short', () => {
    expect(isInsidePath(short, path.join(long, 'src', 'a.js'))).toBe(true)
    expect(isInsidePath(long, path.join(short, 'src', 'a.js'))).toBe(true)
    expect(isInsidePath(short, path.join(users, 'runneradmin', 'other'))).toBe(
      false
    )
  })

  it('spells a path out only to compare it', () => {
    // The helper answers a whole path, so on Windows it gains the drive.
    expect(realPath(short)).toBe(path.resolve(long))
    expect(isInsidePath(short, path.join(short, 'src', 'a.js'))).toBe(true)
  })
})
