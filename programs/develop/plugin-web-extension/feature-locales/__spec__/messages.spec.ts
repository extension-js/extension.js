import * as path from 'node:path'
import {describe, expect, it, vi} from 'vitest'
import {localesMustBeAtProjectRoot} from '../messages'

const HOME = path.resolve(path.sep, 'Users', 'someone')
const PROJECT = path.join(HOME, 'browser-extensions', 'locale-probe')

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os')

  return {...actual, homedir: () => HOME}
})

const toPosix = (value: string) => value.split(path.sep).join('/')

describe('legacy _locales folder warning', () => {
  it('prints both rows relative to a project under the home dir', () => {
    const message = localesMustBeAtProjectRoot(
      path.join(PROJECT, 'src', '_locales'),
      path.join(PROJECT, '_locales'),
      PROJECT
    )

    expect(toPosix(message).split('\n')).toEqual([
      'The _locales folder sits in the legacy next-to-manifest location.',
      'GOT src/_locales',
      'EXPECTED _locales',
      'Chrome reads locales from the extension root, so _locales/ is canonically placed at the project root.',
      'The build uses it either way.',
      'Move the folder to the project root to silence this warning.'
    ])

    expect(message).not.toContain(HOME)
  })

  it('collapses the home dir for a folder outside the project', () => {
    const elsewhere = path.join(HOME, 'other', 'locale-probe')
    const message = localesMustBeAtProjectRoot(
      path.join(elsewhere, 'src', '_locales'),
      path.join(elsewhere, '_locales'),
      PROJECT
    )

    expect(toPosix(message)).toContain(
      '\nGOT ~/other/locale-probe/src/_locales\n'
    )

    expect(toPosix(message)).toContain(
      '\nEXPECTED ~/other/locale-probe/_locales\n'
    )

    expect(message).not.toContain(HOME)
  })
})
