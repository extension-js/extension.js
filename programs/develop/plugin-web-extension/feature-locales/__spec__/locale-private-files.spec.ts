import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {
  build,
  canLink,
  expectNothingPrivate,
  MARKER,
  makeProject,
  manifest
} from '../../feature-html/__spec__/helpers/private-files-project'

// Whole builds of a fixture project whose _locales folder holds, or leads
// to, a file a build never copies.

const TIMEOUT = 120_000

const CATALOG = JSON.stringify({name: {message: 'en'}})
const MARKED_CATALOG = JSON.stringify({name: {message: `${MARKER}-locale`}})

const locales = (names: string[]) =>
  names.filter((name) => name.startsWith('_locales/')).sort()

describe('a _locales folder that holds a file the build never copies', () => {
  it(
    'leaves it out, and names an env file',
    async () => {
      const {root} = makeProject({
        'manifest.json': manifest({default_locale: 'en'}),
        '_locales/en/messages.json': CATALOG,
        '_locales/en/privacy.md': 'privacy',
        '_locales/en/.env': `KEY=${MARKER}-locale-env\n`,
        '_locales/en/.env.example': 'KEY=\n',
        '_locales/en/.npmrc': `# ${MARKER}-locale-npmrc\n`
      })
      const result = await build(root)

      expect(result.errors).toBe(0)
      expect(result.marked).toEqual([])
      expect(locales(result.shipped)).toEqual([
        '_locales/en/.env.example',
        '_locales/en/messages.json',
        '_locales/en/privacy.md'
      ])

      expect(result.printed).toContain(
        "Can't find the file listed in _locales/en/.env."
      )

      // A repository leftover is skipped without a word.
      expect(result.printed).not.toContain('_locales/en/.npmrc')
      expectNothingPrivate(result)
    },
    TIMEOUT
  )

  it(
    'leaves out a locale folder under a private name',
    async () => {
      const {root} = makeProject({
        'manifest.json': manifest({default_locale: 'en'}),
        '_locales/en/messages.json': CATALOG,
        '_locales/.env/messages.json': MARKED_CATALOG
      })
      const result = await build(root)

      expect(result.marked).toEqual([])
      expect(locales(result.shipped)).toEqual(['_locales/en/messages.json'])
      expectNothingPrivate(result)
    },
    TIMEOUT
  )

  it(
    'never walks into node_modules, and says nothing about it',
    async () => {
      const {root} = makeProject({
        'manifest.json': manifest({default_locale: 'en'}),
        '_locales/en/messages.json': CATALOG,
        '_locales/en/node_modules/pkg/data.json': `"${MARKER}-locale-pkg"`,
        '_locales/en/Node_Modules/pkg/data.json': `"${MARKER}-locale-pkg2"`,
        '_locales/node_modules/messages.json': MARKED_CATALOG
      })
      const result = await build(root)

      expect(result.errors).toBe(0)
      expect(result.marked).toEqual([])
      expect(locales(result.shipped)).toEqual(['_locales/en/messages.json'])
      expect(result.printed.toLowerCase()).not.toContain('node_modules')
      expectNothingPrivate(result)
    },
    TIMEOUT
  )

  it.runIf(canLink)(
    'leaves out a _locales folder that leads outside the project',
    async () => {
      const {root} = makeProject({
        'manifest.json': manifest({default_locale: 'en'})
      })
      const outside = path.join(path.dirname(root), 'outside-locales')

      fs.mkdirSync(path.join(outside, 'en'), {recursive: true})
      fs.writeFileSync(
        path.join(outside, 'en', 'messages.json'),
        MARKED_CATALOG
      )

      fs.symlinkSync(outside, path.join(root, '_locales'))

      const result = await build(root)

      expect(result.marked).toEqual([])
      expect(locales(result.shipped)).toEqual([])
      expect(result.printed).toContain(
        "Can't find the file listed in _locales/en/messages.json."
      )

      expectNothingPrivate(result)
    },
    TIMEOUT
  )

  it(
    'stops the build over a default locale that climbs out of _locales',
    async () => {
      const {root} = makeProject({
        'manifest.json': manifest({default_locale: '../outside-locale'}),
        '_locales/en/messages.json': CATALOG
      })
      const outside = path.join(path.dirname(root), 'outside-locale')

      fs.mkdirSync(outside, {recursive: true})
      fs.writeFileSync(path.join(outside, 'messages.json'), MARKED_CATALOG)

      const result = await build(root)

      expect(result.errors).toBe(1)
      expect(result.marked).toEqual([])
      expect(result.shipped).toEqual([])
      expectNothingPrivate(result)
    },
    TIMEOUT
  )
})
