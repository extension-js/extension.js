// Ownership is a tri-state, not a boolean. The chromium controller used to ask
// `extensionIdBelongsToOutPath` (returning `boolean | null`) and both call
// sites only acted on `=== false`, so `null` ("cannot tell yet") behaved
// exactly like `true` ("verified mine"), a freshly created profile whose
// Preferences had not flushed, or an id absent from Preferences, would get a
// foreign extension silently adopted as the dev extension.
//
// This spec locks the shared decision: 'mine' | 'not_mine' | 'unknown', built
// from faked profile directories on disk, no real browser.

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {afterEach, describe, expect, it} from 'vitest'
import {
  classifyExtensionOwnership,
  findStaleUnpackedExtensionIds
} from '../../run-chromium/cdp/cdp-extension-controller/ownership'

const tempDirs: string[] = []

function makeProfile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-ownership-profile-'))
  tempDirs.push(dir)
  return dir
}

function makeOutPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-ownership-out-'))
  tempDirs.push(dir)
  return dir
}

function writePreferences(
  profileDir: string,
  settings: Record<string, {path?: string}>,
  {subdir}: {subdir?: string} = {}
): void {
  const target = subdir ? path.join(profileDir, subdir) : profileDir
  fs.mkdirSync(target, {recursive: true})
  fs.writeFileSync(
    path.join(target, 'Preferences'),
    JSON.stringify({extensions: {settings}}),
    'utf-8'
  )
}

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop()
    if (dir) fs.rmSync(dir, {recursive: true, force: true})
  }
})

describe('classifyExtensionOwnership, the one ownership decision', () => {
  it("returns 'mine' when Preferences maps the id to our outPath", () => {
    const profile = makeProfile()
    const out = makeOutPath()
    writePreferences(profile, {'my-ext-id': {path: out}})

    expect(classifyExtensionOwnership(profile, out, 'my-ext-id')).toBe('mine')
  })

  it("returns 'mine' when Preferences lives under the Default subprofile", () => {
    const profile = makeProfile()
    const out = makeOutPath()
    writePreferences(profile, {'my-ext-id': {path: out}}, {subdir: 'Default'})

    expect(classifyExtensionOwnership(profile, out, 'my-ext-id')).toBe('mine')
  })

  it("returns 'not_mine' when the id is recorded at a different path", () => {
    const profile = makeProfile()
    const out = makeOutPath()
    const foreign = makeOutPath()
    writePreferences(profile, {'foreign-id': {path: foreign}})

    // A foreign extension that verifiably is not ours stays rejected.
    expect(classifyExtensionOwnership(profile, out, 'foreign-id')).toBe(
      'not_mine'
    )
  })

  it("returns 'unknown' when the profile has not written Preferences yet", () => {
    const profile = makeProfile() // fresh profile, no Preferences file
    const out = makeOutPath()

    // The cannot-know moment: not a yes. Callers must resolve it explicitly.
    expect(classifyExtensionOwnership(profile, out, 'my-ext-id')).toBe(
      'unknown'
    )
  })

  it("returns 'unknown' when the id is absent from an existing Preferences", () => {
    const profile = makeProfile()
    const out = makeOutPath()
    const foreign = makeOutPath()
    writePreferences(profile, {'some-other-id': {path: foreign}})

    expect(classifyExtensionOwnership(profile, out, 'my-ext-id')).toBe(
      'unknown'
    )
  })

  it("returns 'unknown' when Preferences cannot be read (malformed JSON)", () => {
    const profile = makeProfile()
    const out = makeOutPath()
    fs.writeFileSync(
      path.join(profile, 'Preferences'),
      '{not valid json',
      'utf-8'
    )

    expect(classifyExtensionOwnership(profile, out, 'my-ext-id')).toBe(
      'unknown'
    )
  })

  it("returns 'unknown' when there is no profile path at all", () => {
    const out = makeOutPath()
    expect(classifyExtensionOwnership(undefined, out, 'my-ext-id')).toBe(
      'unknown'
    )
  })

  it("returns 'unknown' for an empty extension id", () => {
    const profile = makeProfile()
    const out = makeOutPath()
    writePreferences(profile, {'my-ext-id': {path: out}})

    expect(classifyExtensionOwnership(profile, out, '')).toBe('unknown')
  })

  it('normalizes stored vs out paths before comparing (trailing separator)', () => {
    const profile = makeProfile()
    const out = makeOutPath()
    writePreferences(profile, {'my-ext-id': {path: out + path.sep}})

    expect(classifyExtensionOwnership(profile, out, 'my-ext-id')).toBe('mine')
  })
})

describe('findStaleUnpackedExtensionIds, prior loads to evict (#49)', () => {
  // A project tree with a canonical build dir and a legacy sibling under the
  // same dist root, so distRoot resolution is exercised for real.
  function makeProject(): {dist: string; current: string; legacy: string} {
    const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-stale-proj-'))
    tempDirs.push(proj)
    const dist = path.join(proj, 'dist')
    const current = path.join(dist, 'chrome')
    const legacy = path.join(dist, 'extension-js', 'chrome')
    fs.mkdirSync(current, {recursive: true})
    fs.mkdirSync(legacy, {recursive: true})
    return {dist, current, legacy}
  }

  it('flags a sibling build under the same dist root, keeping the current one', () => {
    const profile = makeProfile()
    const {current, legacy} = makeProject()
    writePreferences(profile, {
      current: {path: current},
      stale: {path: legacy}
    })

    const stale = findStaleUnpackedExtensionIds(profile, current)
    expect(stale).toEqual(['stale'])
  })

  it('never flags an extension from another project (different dist root)', () => {
    const profile = makeProfile()
    const {current} = makeProject()
    const other = makeProject()
    writePreferences(profile, {
      current: {path: current},
      otherProject: {path: other.current}
    })

    expect(findStaleUnpackedExtensionIds(profile, current)).toEqual([])
  })

  it('never flags a store-installed extension (path outside any dist)', () => {
    const profile = makeProfile()
    const {current} = makeProject()
    const packed = makeOutPath() // an install dir with no `dist` segment
    writePreferences(profile, {
      current: {path: current},
      packed: {path: packed}
    })

    expect(findStaleUnpackedExtensionIds(profile, current)).toEqual([])
  })

  it('returns [] when the profile has no Preferences yet', () => {
    const profile = makeProfile()
    const {current} = makeProject()
    expect(findStaleUnpackedExtensionIds(profile, current)).toEqual([])
  })

  it('returns [] when there is no profile path', () => {
    const {current} = makeProject()
    expect(findStaleUnpackedExtensionIds(undefined, current)).toEqual([])
  })

  it('uses the innermost dist, so an ancestor dir named "dist" cannot widen the root', () => {
    // A project whose path itself contains a "dist" ancestor segment. The dist
    // root must be the innermost `.../proj/dist`, NOT the ancestor `/tmp/.../dist`,
    // otherwise an unrelated extension under the ancestor would be evicted.
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-dist-ancestor-'))
    tempDirs.push(base)
    const ancestor = path.join(base, 'dist') // ancestor literally named "dist"
    const projDist = path.join(ancestor, 'proj', 'dist')
    const current = path.join(projDist, 'chrome')
    const legacy = path.join(projDist, 'extension-js', 'chrome')
    // An unrelated extension living under the ancestor "dist" but NOT this project.
    const unrelated = path.join(ancestor, 'someone-else', 'build')
    fs.mkdirSync(current, {recursive: true})
    fs.mkdirSync(legacy, {recursive: true})
    fs.mkdirSync(unrelated, {recursive: true})

    const profile = makeProfile()
    writePreferences(profile, {
      current: {path: current},
      sibling: {path: legacy},
      unrelated: {path: unrelated}
    })

    // Only the same-project sibling is evicted; the unrelated one is spared.
    expect(findStaleUnpackedExtensionIds(profile, current)).toEqual(['sibling'])
  })
})
