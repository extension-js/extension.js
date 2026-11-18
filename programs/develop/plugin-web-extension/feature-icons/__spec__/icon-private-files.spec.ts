import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {
  buildProject,
  canLink,
  MARKER,
  makeProject,
  manifest,
  PUBLIC_OUTPUT
} from '../../feature-html/__spec__/helpers/private-files-project'

// Whole builds of a fixture project whose manifest names, as an icon, a file
// a build never copies. One field per build.

const TIMEOUT = 120_000

const WITHHELD = [
  '.env',
  '/.env.local',
  '.git/config',
  'node_modules/pkg/data.json',
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
      const result = await buildProject(root)

      expect(result.marked).toEqual([])
      expect(result.shipped).toEqual([])
      expect(result.errors).toBe(1)
      expect(result.printed).toContain(
        feature === 'theme/images'
          ? 'Check the theme/images/theme_frame field in your manifest.json file.'
          : `Can't find an icon file listed in ${feature}.`
      )

      expect(result.printed).not.toContain(MARKER)
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
            default_icon: {16: '/node_modules/pkg/data.json'}
          }
        })
      })
      const result = await buildProject(root)

      expect(result.marked).toEqual([])
      expect(result.shipped).toEqual([])
      expect(result.notFound).toEqual(
        [
          path.join(root, '.env'),
          path.join(root, '.npmrc'),
          path.join(root, 'node_modules/pkg/data.json')
        ].sort()
      )

      expect(result.printed).not.toContain(MARKER)
    },
    TIMEOUT
  )
})

describe('a manifest icon that names a file the build ships', () => {
  it.each(FIELDS)(
    '%s: keeps an ordinary icon',
    async (_label, _feature, field) => {
      const {root} = makeProject({
        'icons/own.png': 'png',
        'manifest.json': manifest(field('icons/own.png'))
      })
      const result = await buildProject(root)

      expect(result.errors).toBe(0)
      expect(
        result.shipped.filter((name) => name.endsWith('own.png'))
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
      const result = await buildProject(root)

      expect(result.errors).toBe(0)
      expect(result.shipped).toEqual(PUBLIC_OUTPUT)
      expect(result.printed).not.toContain("Can't find an icon file")
    },
    TIMEOUT
  )
})
