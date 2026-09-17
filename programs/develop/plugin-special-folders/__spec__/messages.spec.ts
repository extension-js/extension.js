import * as path from 'node:path'
import {describe, expect, it, vi} from 'vitest'
import {publicFolderShadowed, publicMustBeAtProjectRoot} from '../messages'

// A fake home dir, so the `~` form is asserted on any machine and any lane.
const HOME = path.resolve(path.sep, 'Users', 'someone')
const PROJECT = path.join(HOME, 'browser-extensions', 'preact')

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os')

  return {...actual, homedir: () => HOME}
})

const toPosix = (value: string) => value.split(path.sep).join('/')

describe('legacy public folder warnings', () => {
  it('prints both rows relative to a project under the home dir', () => {
    const message = publicMustBeAtProjectRoot(
      path.join(PROJECT, 'src', 'public'),
      path.join(PROJECT, 'public'),
      PROJECT
    )

    expect(toPosix(message)).toContain('\nGOT src/public\n')
    expect(toPosix(message)).toContain('\nEXPECTED public\n')
    expect(message).not.toContain(HOME)
  })

  it('collapses the home dir for a folder outside the project', () => {
    const elsewhere = path.join(HOME, 'other', 'public')
    const message = publicFolderShadowed(
      path.join(PROJECT, 'public'),
      elsewhere,
      PROJECT
    )

    expect(toPosix(message)).toContain('\nUSING public\n')
    expect(toPosix(message)).toContain('\nIGNORED ~/other/public\n')
    expect(message).not.toContain(HOME)
  })

  it('leaves an absolute path outside the home dir as is', () => {
    const outside = path.resolve(path.sep, 'srv', 'checkout')
    const message = publicMustBeAtProjectRoot(
      path.join(outside, 'src', 'public'),
      path.join(outside, 'public'),
      PROJECT
    )

    expect(toPosix(message)).toContain(`\nGOT ${toPosix(outside)}/src/public\n`)

    expect(toPosix(message)).toContain(
      `\nEXPECTED ${toPosix(outside)}/public\n`
    )

    expect(message).not.toContain('~')
  })
})
