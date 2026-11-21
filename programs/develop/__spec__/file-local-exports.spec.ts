import {describe, expect, it} from 'vitest'
import {exportedNames, exportsNoProductFileReads} from './helpers/export-uses'

// The names nothing imports that keep the keyword, each with why.
const KEPT: Array<[file: string, name: string, why: string]> = [
  [
    'lib/live-dev-session.ts',
    'LiveDevSession',
    'the declarations name it as the return type of refuseBuildOverLiveSession'
  ],
  [
    'lib/manifest-types.ts',
    'ManifestIcons',
    'the declarations name it as the return type of three action overrides'
  ],
  [
    'plugin-css/css-tools/postcss.ts',
    'initialize',
    'text of the import hook the file hands to Node, not its own export'
  ]
]

describe('what a develop product file exports', () => {
  const found = exportsNoProductFileReads()

  // An export is a promise to another file. One that nothing reads is a
  // private name with a wider surface, so the keyword comes off instead.
  it('is read by another file, a spec at least', () => {
    const unread = found
      .filter((use) => use.readBy === 'nothing')
      .map((use) => `${use.file} ${use.name}`)

    expect(unread).toEqual(KEPT.map(([file, name]) => `${file} ${name}`))
  })

  it('gives every name it lets through a reason', () => {
    for (const [, , why] of KEPT) {
      expect(why.length).toBeGreaterThan(20)
    }
  })
})

describe('the scan of exported names', () => {
  it('reads declarations, lists and renamed list entries', () => {
    expect(
      exportedNames(
        [
          'export function one() {}',
          'export async function two() {}',
          'export const three = 3',
          'export type Four = string',
          'export interface Five {}',
          'export class Six {}',
          'const seven = 7',
          'const inner = 8',
          'export {seven, inner as eight, type Nine}',
          'export default one'
        ].join('\n')
      )
    ).toEqual([
      'one',
      'two',
      'three',
      'Four',
      'Five',
      'Six',
      'seven',
      'eight',
      'Nine'
    ])
  })

  it('reads a file saved with Windows line endings the same way', () => {
    expect(
      exportedNames('export const one = 1\r\nexport function two() {}\r\n')
    ).toEqual(['one', 'two'])
  })
})
