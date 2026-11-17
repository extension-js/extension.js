import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {buildComplete, zipArtifactReady} from '../messages'
import {displayPath, relativeToDir} from '../paths'

const root = path.parse(process.cwd()).root
const stripAnsi = (s: string) => s.replace(/\[[0-9;]*m/g, '')

afterEach(() => {
  vi.restoreAllMocks()
})

describe('a path printed for a person', () => {
  it('is relative inside the directory the command ran from', () => {
    const base = path.join(root, 'work', 'app')

    expect(displayPath(path.join(base, 'dist', 'chrome'), base)).toBe(
      path.join('dist', 'chrome')
    )
  })

  it('stays absolute when the command ran from the filesystem root', () => {
    const target = path.join(root, 'private', 'tmp', 'app', 'dist', 'chrome')

    expect(relativeToDir(target, root)).toBeNull()
    expect(displayPath(target, root)).toBe(target)
  })

  it('collapses the home directory when the command ran from the root', () => {
    const target = path.join(os.homedir(), 'app', 'dist', 'chrome')

    expect(displayPath(target, root)).toBe(
      `~${path.sep}${path.join('app', 'dist', 'chrome')}`
    )
  })

  it('reads the root as the default base when it is the working directory', () => {
    const target = path.join(root, 'private', 'tmp', 'app', 'dist', 'chrome')

    vi.spyOn(process, 'cwd').mockReturnValue(root)

    expect(displayPath(target)).toBe(target)
  })

  it('reaches the built line and the packaged line whole', () => {
    const dist = path.join(root, 'private', 'tmp', 'app', 'dist', 'chrome')
    const zip = path.join(root, 'private', 'tmp', 'app', 'dist', 'app.zip')

    expect(
      stripAnsi(buildComplete('chrome', displayPath(dist, root), 355))
    ).toContain(`built for production in ${dist} (`)

    expect(stripAnsi(zipArtifactReady(displayPath(zip, root), 606))).toContain(
      `Packaged ${zip} (`
    )
  })
})
