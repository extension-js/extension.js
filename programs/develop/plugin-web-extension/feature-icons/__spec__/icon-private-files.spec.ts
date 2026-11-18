import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {
  build,
  canLink,
  expectNothingPrivate,
  makeProject,
  manifest,
  notFoundPaths,
  PUBLIC_OUTPUT
} from '../../feature-html/__spec__/helpers/private-files-project'

// Whole builds of a fixture project whose manifest names, as an icon, a file
// a build never copies. One field per build.

const TIMEOUT = 120_000

const WITHHELD = [
  '.env',
  '/.env.local',
  '.npmrc',
  '/.npmrc',
  '.git/config',
  'node_modules/pkg/.env',
  '../outside.txt',
  '/a/../.envrc',
  '/%2Eenv',
  ...(canLink ? ['linked.txt', 'linked-folder/inner.txt'] : [])
]

type Field = (icon: string) => Record<string, unknown>

const popup = {default_popup: 'popup.html'}

const FIELDS: Array<[string, string, Field]> = [
  ['icons', 'icons', (icon) => ({icons: {16: icon}})],
  [
    'action.default_icon as a string',
    'action/default_icon',
    (icon) => ({action: {...popup, default_icon: icon}})
  ],
  [
    'action.default_icon by size',
    'action/default_icon',
    (icon) => ({action: {...popup, default_icon: {16: icon}}})
  ],
  ['icon_variants', 'icon_variants', (icon) => ({icon_variants: [{16: icon}]})],
  [
    'theme.images',
    'theme/images',
    (icon) => ({theme: {images: {theme_frame: icon}}})
  ]
]

const CASES = FIELDS.flatMap(([label, feature, field]) =>
  WITHHELD.map((ref) => [label, ref, feature, field] as const)
)

describe('a manifest icon that names a file the build never copies', () => {
  it.each(CASES)(
    '%s: stops the build over %s',
    async (_label, ref, feature, field) => {
      const {root} = makeProject({'manifest.json': manifest(field(ref))})
      const result = await build(root)

      expect(result.marked).toEqual([])
      expect(result.shipped).toEqual([])
      expect(result.errors).toBe(1)
      expect(result.printed).toContain(
        feature === 'theme/images'
          ? 'Check the theme/images/theme_frame field in your manifest.json file.'
          : `Can't find an icon file listed in ${feature}.`
      )

      expectNothingPrivate(result)
    },
    TIMEOUT
  )

  it(
    'names each path where the build looked',
    async () => {
      const {root} = makeProject({
        'manifest.json': manifest({
          icons: {16: '/.env', 32: './.npmrc'},
          action: {
            default_popup: 'popup.html',
            default_icon: {16: '/node_modules/pkg/.env'}
          }
        })
      })
      const result = await build(root)

      expect(result.marked).toEqual([])
      expect(result.shipped).toEqual([])
      expect(notFoundPaths(result.printed)).toEqual(
        [
          path.join(root, '.env'),
          path.join(root, '.npmrc'),
          path.join(root, 'node_modules/pkg/.env')
        ].sort()
      )

      expectNothingPrivate(result)
    },
    TIMEOUT
  )
})

const SHIPPED_ICONS = [
  ['an ordinary icon', 'icons/own.png', 'own.png'],
  ['an icon of an installed package', 'node_modules/pkg/icon.png', 'icon.png']
] as const

const SHIPPED_CASES = FIELDS.flatMap(([label, , field]) =>
  SHIPPED_ICONS.map(
    ([what, icon, name]) => [label, what, icon, name, field] as const
  )
)

describe('a manifest icon that names a file the build ships', () => {
  it.each(SHIPPED_CASES)(
    '%s: keeps %s',
    async (_label, _what, icon, name, field) => {
      const {root} = makeProject({
        'icons/own.png': 'png',
        'manifest.json': manifest(field(icon))
      })
      const result = await build(root)

      expect(result.errors).toBe(0)
      expect(
        result.shipped.filter((shipped) => shipped.endsWith(name))
      ).toHaveLength(1)

      expect(result.printed).not.toContain("Can't find an icon file")
    },
    TIMEOUT
  )

  it(
    'keeps a dot-named file from public/',
    async () => {
      const {root} = makeProject({
        'manifest.json': manifest({
          icons: {
            16: '/logo.png',
            32: '/.env.example',
            48: '/.well-known/links.json'
          }
        })
      })
      const result = await build(root)

      expect(result.errors).toBe(0)
      expect(result.shipped).toEqual(PUBLIC_OUTPUT)
      expect(result.printed).not.toContain("Can't find an icon file")
    },
    TIMEOUT
  )
})
