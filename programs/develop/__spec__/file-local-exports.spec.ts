import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {
  COPIED_ELSEWHERE,
  exportedNames,
  exportsNoProductFileReads
} from './helpers/export-uses'

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
    'lib/manifest-utils.ts',
    'FilterKeysOptions',
    'the declarations name it as the options type of filterKeysForThisBrowser'
  ],
  [
    'plugin-css/css-tools/postcss.ts',
    'initialize',
    'text of the import hook the file hands to Node, not its own export'
  ],
  [
    'plugin-web-extension/feature-manifest/manifest-lib/webkit-unsupported-keys.ts',
    'WebkitDroppedPage',
    'the declarations name it as the return type of webkitDroppedSurfacePages'
  ]
]

// The names only a spec reads and the exporting file never uses again.
const SPEC_ONLY: Array<[file: string, name: string, why: string]> = [
  [
    'command-build.ts',
    'resetBuildToolchainLine',
    'clears the once per process toolchain line between spec rows'
  ],
  [
    'lib/blank-comments.ts',
    'keptBlankedSources',
    'reads the size of the blanked source cache, which nothing else can see'
  ],
  [
    'lib/companion-extensions/resolve-config.ts',
    'isCompanionStoreLink',
    'the only door a spec has to the private store address parser'
  ],
  [
    'lib/companion-extensions/resolve-config.ts',
    'isCompanionWebLink',
    'the only door a spec has to the private web address parser'
  ],
  [
    'lib/taken-extension-base.ts',
    'TAKE_BLOCK_COLUMNS',
    'pins the column count the hand-written bridge file repeats'
  ],
  [
    'plugin-css/css-tools/postcss.ts',
    'PostCssLoaderRule',
    'the rule shape specs narrow the loader result to before reading it'
  ],
  [
    'plugin-perf-budgets/index.ts',
    'resetPerfBudgetNotices',
    'clears the once per process budget notices between spec rows'
  ],
  [
    'plugin-web-extension/feature-manifest/manifest-lib/edge-options-notice.ts',
    'resetEdgeOptionsNotice',
    'clears the once per process Edge notice between spec rows'
  ],
  [
    'plugin-web-extension/feature-manifest/manifest-lib/filter-keys-gecko.ts',
    'resetGeckoKeyNotices',
    'clears the once per process Gecko notices between spec rows'
  ],
  [
    'plugin-web-extension/feature-manifest/manifest-lib/icon-variants-fallback.ts',
    'resetIconVariantsNotice',
    'clears the once per process icon notice between spec rows'
  ],
  [
    'types.ts',
    'JsFrameworkLoaderRule',
    'the rule shape specs narrow a framework loader result to'
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

  // A name a spec alone reads is product code only a spec keeps alive. The
  // file using it again makes it an ordinary seam, which stays unlisted.
  it('is used by its own file when only a spec reads it', () => {
    const specOnly = found
      .filter((use) => use.readBy === 'specs' && !use.usedInFile)
      .map((use) => `${use.file} ${use.name}`)

    expect(specOnly).toEqual(SPEC_ONLY.map(([file, name]) => `${file} ${name}`))
  })

  // A copy elsewhere reads names no develop file does, so the scan skips
  // the file. The skip is earned only while the copy is still the same text.
  it('skips a file only while another program holds the same text', () => {
    const programs = path.resolve(__dirname, '..', '..')
    const belowHeader = (file: string) =>
      fs
        .readFileSync(path.join(programs, file), 'utf8')
        .replace(/\r\n/g, '\n')
        .replace(/^(?:\/\/.*\n)+/, '')

    expect([...COPIED_ELSEWHERE.keys()]).toEqual([
      'lib/corepack-registry.ts',
      'lib/messaging.ts'
    ])

    expect(found.filter((use) => COPIED_ELSEWHERE.has(use.file))).toEqual([])

    for (const [file, copy] of COPIED_ELSEWHERE) {
      expect(belowHeader(copy), copy).toBe(belowHeader(`develop/${file}`))
    }
  })

  it('gives every name it lets through a reason', () => {
    for (const [, , why] of [...KEPT, ...SPEC_ONLY]) {
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
