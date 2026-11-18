import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'
import {
  buildProject,
  canLink,
  MARKER,
  makeProject,
  manifest,
  removeProjects
} from '../../feature-html/__spec__/helpers/private-files-project'

// Whole builds of a fixture project whose manifest names, as an icon, a file
// a build never copies, and dot-named files in public/ that it does.

afterAll(removeProjects)

const TIMEOUT = 120_000

const WITHHELD = [
  '/.env',
  '/.env.local',
  '/.npmrc',
  '/.git/config',
  '/a/../.envrc',
  '/node_modules/pkg/data.json',
  '/%2Eenv',
  './.envrc',
  'node_modules/pkg/data.json',
  ...(canLink ? ['/linked.txt', 'linked-folder/inner.txt'] : [])
]

const sized = (paths: string[]) =>
  Object.fromEntries(paths.map((value, index) => [String(16 + index), value]))

describe('a manifest icon that names a file the build never copies', () => {
  it.each(WITHHELD)(
    'stops the build and calls %s missing',
    async (ref) => {
      const {root} = makeProject({
        'manifest.json': manifest({icons: {16: ref}})
      })
      const result = await buildProject(root)

      expect(result.marked).toEqual([])
      expect(result.shipped).toEqual([])
      expect(result.errors).toBe(1)
      expect(result.printed).toContain(
        "Can't find an icon file listed in icons."
      )

      expect(result.printed).not.toContain(MARKER)
    },
    TIMEOUT
  )

  it(
    'names each path as written, in every icon field',
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

      expect(result.printed).toContain('listed in action/default_icon.')
      expect(result.printed).not.toContain(MARKER)
    },
    TIMEOUT
  )
})

describe('a manifest icon that names a file the build ships', () => {
  it(
    'keeps a dot-named file from public/ and an ordinary icon',
    async () => {
      const {root} = makeProject({
        'icons/own.png': 'png',
        'manifest.json': manifest({
          icons: sized([
            '/logo.png',
            '/.env.example',
            '/.well-known/links.json',
            'icons/own.png'
          ])
        })
      })
      const result = await buildProject(root)

      expect(result.errors).toBe(0)
      expect(result.shipped).toEqual([
        '.env.example',
        '.well-known/links.json',
        'icons/own.png',
        'logo.png'
      ])

      expect(result.printed).not.toContain("Can't find an icon file")
    },
    TIMEOUT
  )
})
