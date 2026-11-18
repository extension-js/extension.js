import {describe, expect, it} from 'vitest'
import {
  build,
  canLink,
  expectNothingPrivate,
  makeProject,
  manifest,
  outputHolding,
  PAGE
} from './helpers/private-files-project'

// Whole builds of a fixture project whose manifest names, as a page, a file
// a build never copies. One field per build.

const TIMEOUT = 120_000

const WITHHELD = [
  '.env',
  '.git/config',
  'node_modules/pkg/.env',
  '../outside.txt',
  ...(canLink ? ['linked.txt'] : [])
]

type Field = (page: string) => Record<string, unknown>

// The field as a finding names it, and whether the build stops over a page
// it cannot find there.
const FIELDS: Array<[string, boolean, Field, ('chrome' | 'firefox')?]> = [
  ['action.default_popup', true, (page) => ({action: {default_popup: page}})],
  ['options_ui.page', true, (page) => ({options_ui: {page}})],
  ['options_page', true, (page) => ({options_page: page})],
  ['devtools_page', true, (page) => ({devtools_page: page})],
  [
    'chrome_url_overrides.newtab',
    true,
    (page) => ({chrome_url_overrides: {newtab: page}})
  ],
  [
    'side_panel.default_path',
    true,
    (page) => ({side_panel: {default_path: page}})
  ],
  ['sandbox.pages', false, (page) => ({sandbox: {pages: [page]}})],
  [
    'background.page',
    true,
    (page) => ({manifest_version: 2, action: undefined, background: {page}})
  ],
  [
    'sidebar_action.default_panel',
    false,
    (page) => ({sidebar_action: {default_panel: page}}),
    'firefox'
  ]
]

const CASES = FIELDS.flatMap(([label, stops, field, browser]) =>
  WITHHELD.map((ref) => [label, ref, stops, field, browser] as const)
)

describe('a manifest page field that names a file the build never copies', () => {
  it.each(CASES)(
    '%s: leaves %s out and calls the page missing',
    async (label, ref, stops, field, browser) => {
      const {root} = makeProject({'manifest.json': manifest(field(ref))})
      const result = await build(root, browser)

      expect(result.marked).toEqual([])
      expectNothingPrivate(result)
      expect(result.printed).toContain(
        `Can't find the page listed in ${label}.`
      )

      expect(result.errors).toBe(stops ? 1 : 0)
      expect(result.shipped.filter((name) => name.endsWith('.html'))).toEqual(
        []
      )
    },
    TIMEOUT
  )
})

const SHIPPED_PAGES = [
  ['a page of the project', 'views/own.html'],
  ['a page of an installed package', 'node_modules/pkg/page.html']
] as const

const SHIPPED_CASES = FIELDS.flatMap(([label, , field, browser]) =>
  SHIPPED_PAGES.map(
    ([what, page]) => [label, what, page, field, browser] as const
  )
)

describe('a manifest page field that names a page the build ships', () => {
  it.each(SHIPPED_CASES)(
    '%s: ships %s',
    async (_label, _what, page, field, browser) => {
      const {root} = makeProject({
        'views/own.html': PAGE.replace('<body>', '<body>own page'),
        'manifest.json': manifest(field(page))
      })
      const result = await build(root, browser)

      expect(result.errors).toBe(0)
      expect(result.printed).not.toContain("Can't find the page")
      expect(outputHolding(root, 'own page', browser)).toHaveLength(1)
    },
    TIMEOUT
  )
})
