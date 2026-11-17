import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {
  collapseHomeDirInCardValue,
  runningInDevelopment
} from '../browsers-lib/messages'

const stripAnsi = (s: string) => s.replace(/\[[0-9;]*m/g, '')
// The registry the build fills when a project is named through a link.
const ASKED_PATHS = Symbol.for('extension-js.asked-paths')
const shared = globalThis as {[key: symbol]: Map<string, string> | undefined}
const before = shared[ASKED_PATHS]

afterEach(() => {
  shared[ASKED_PATHS] = before
})

describe('the card Profile row of a project named through a link', () => {
  const real = path.join(path.sep, 'volumes', 'real', 'project')
  const asked = path.join(path.sep, 'work', 'link')
  const profile = path.join('dist', 'extension-js', 'profiles', 'chrome')

  it('prints the profile under the spelling the command was given', () => {
    shared[ASKED_PATHS] = new Map([[real, asked]])

    const card = stripAnsi(
      runningInDevelopment(
        {name: 'My Extension', version: '1.0.0'},
        'chrome',
        {
          data: {
            id: 'abcdefghijklmnopabcdefghijklmnop',
            management: {name: 'My Extension', version: '1.0.0'}
          }
        },
        'Chrome 140',
        undefined,
        {profilePath: path.join(real, profile)}
      )
    )

    expect(card).toContain(`Profile        ${path.join(asked, profile)}`)
    expect(card).not.toContain(real)
  })

  it('leaves a path outside the linked project, and a sibling of it, alone', () => {
    shared[ASKED_PATHS] = new Map([[real, asked]])

    expect(collapseHomeDirInCardValue(`${real}-sibling`)).toBe(
      `${real}-sibling`
    )

    expect(collapseHomeDirInCardValue('/unrelated/path')).toBe(
      '/unrelated/path'
    )
  })

  it('prints the path as it is when no build has filled the registry', () => {
    shared[ASKED_PATHS] = undefined

    expect(collapseHomeDirInCardValue(path.join(real, profile))).toBe(
      path.join(real, profile)
    )
  })
})
