import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'

const developRoot = path.resolve(__dirname, '..')

function sources(dir: string, found: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    if (['node_modules', 'dist'].includes(entry.name)) continue
    if (entry.name.startsWith('.')) continue

    const full = path.join(dir, entry.name)

    if (entry.isDirectory()) sources(full, found)
    else if (/\.(ts|tsx|mts)$/.test(entry.name)) found.push(full)
  }

  return found
}

const named = (file: string) =>
  path.relative(developRoot, file).split(path.sep).join('/')

// A static import, a dynamic one, a mock and a require all make one plugin
// depend on a file of another, so each form is read.
const SPECIFIER =
  /(?:from\s+|import\(\s*|vi\.(?:do)?mock\(\s*|require\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g

function reaches(): {product: string[]; spec: string[]} {
  const product = new Set<string>()
  const spec = new Set<string>()

  for (const file of sources(developRoot)) {
    const name = named(file)
    const owner = name.split('/')[0]

    if (!owner.startsWith('plugin-')) continue

    for (const match of fs.readFileSync(file, 'utf8').matchAll(SPECIFIER)) {
      const target = named(path.resolve(path.dirname(file), match[1]))
      const other = target.split('/')[0]

      if (!other.startsWith('plugin-') || other === owner) continue

      const isSpec = name.includes('/__spec__/') || name.includes('.spec.')

      ;(isSpec ? spec : product).add(`${owner} -> ${target}`)
    }
  }

  return {product: [...product].sort(), spec: [...spec].sort()}
}

// Every file of one plugin that a product file of another plugin reads, with
// why it may. A rule two plugins share belongs in lib, so this list only
// shrinks: a new reach fails here, and one that is gone must be removed.
const PRODUCT_REACHES: Array<[reach: string, why: string]> = [
  [
    'plugin-browsers -> plugin-reload',
    'the launcher receives reload instructions through the session reload publishes'
  ],
  [
    'plugin-compatibility -> plugin-web-extension/feature-manifest/manifest-lib/manifest',
    'held: the manifest reader with its browser overrides is not in lib yet'
  ],
  [
    'plugin-compatibility -> plugin-web-extension/feature-scripts/contracts',
    'web-extension names the content script layers and every other plugin reads the names'
  ],
  [
    'plugin-compatibility -> plugin-web-extension/shared/initial-files',
    'shared/ is the folder web-extension publishes to the other plugins'
  ],
  [
    'plugin-compatibility -> plugin-web-extension/shared/scannable-source-path',
    'shared/ is the folder web-extension publishes to the other plugins'
  ],
  [
    'plugin-compilation -> plugin-web-extension/feature-manifest/manifest-lib/manifest',
    'held: the manifest reader with its browser overrides is not in lib yet'
  ],
  [
    'plugin-css -> plugin-web-extension/feature-scripts/contracts',
    'web-extension names the content script layers and every other plugin reads the names'
  ],
  [
    'plugin-css -> plugin-web-extension/shared/script-entry-path',
    'shared/ is the folder web-extension publishes to the other plugins'
  ],
  [
    'plugin-css -> plugin-web-extension/shared/script-graph',
    'shared/ is the folder web-extension publishes to the other plugins'
  ],
  [
    'plugin-js-frameworks -> plugin-web-extension/feature-scripts/contracts',
    'web-extension names the content script layers and every other plugin reads the names'
  ],
  [
    'plugin-js-frameworks -> plugin-web-extension/shared/html-assets',
    'shared/ is the folder web-extension publishes to the other plugins'
  ],
  [
    'plugin-js-frameworks -> plugin-web-extension/shared/html-page-entries',
    'shared/ is the folder web-extension publishes to the other plugins'
  ],
  [
    'plugin-js-frameworks -> plugin-web-extension/shared/manifest-fields',
    'shared/ is the folder web-extension publishes to the other plugins'
  ],
  [
    'plugin-reload -> plugin-web-extension/feature-scripts/contracts',
    'web-extension names the content script layers and every other plugin reads the names'
  ],
  [
    'plugin-reload -> plugin-web-extension/shared/background-asset',
    'shared/ is the folder web-extension publishes to the other plugins'
  ],
  [
    'plugin-reload -> plugin-web-extension/shared/chunk-loading-target-extensions',
    'a registry: reload hands its part in, so web-extension never imports reload'
  ],
  [
    'plugin-reload -> plugin-web-extension/shared/content-script-wrapper-extensions',
    'a registry: reload hands its part in, so web-extension never imports reload'
  ],
  [
    'plugin-reload -> plugin-web-extension/shared/html-page-extensions',
    'a registry: reload hands its part in, so web-extension never imports reload'
  ],
  [
    'plugin-reload -> plugin-web-extension/shared/initial-files',
    'shared/ is the folder web-extension publishes to the other plugins'
  ],
  [
    'plugin-reload -> plugin-web-extension/shared/kept-resource-extensions',
    'a registry: reload hands its part in, so web-extension never imports reload'
  ],
  [
    'plugin-special-folders -> plugin-web-extension/shared/html-page-entries',
    'shared/ is the folder web-extension publishes to the other plugins'
  ],
  [
    'plugin-special-folders -> plugin-web-extension/shared/manifest-fields',
    'shared/ is the folder web-extension publishes to the other plugins'
  ],
  [
    'plugin-special-folders -> plugin-web-extension/shared/root-absolute-refs-emitter',
    'a registry: the HTML feature hands its emitter in, so the copier never reads the feature'
  ],
  [
    'plugin-web-extension -> plugin-css/css-lib/inline-content-script-css',
    'held: web-extension inlines sheets with the private code of the CSS plugin'
  ],
  [
    'plugin-web-extension -> plugin-css/css-lib/inline-css-imports',
    'held: web-extension inlines sheets with the private code of the CSS plugin'
  ],
  [
    'plugin-web-extension -> plugin-css/css-lib/messages',
    'held: web-extension prints a message of the CSS plugin'
  ]
]

// What the specs of one plugin read in another. A spec may build a real
// compile from several plugins, so this list is wider than the product one.
const SPEC_REACHES = [
  'plugin-browsers -> plugin-reload',
  'plugin-browsers -> plugin-reload/__spec__/helpers/session-bridge',
  'plugin-browsers -> plugin-reload/steps/inject-bridge-producer',
  'plugin-compatibility -> plugin-web-extension/feature-scripts/contracts',
  'plugin-compilation -> plugin-web-extension/feature-manifest/manifest-lib/manifest',
  'plugin-css -> plugin-static-assets',
  'plugin-css -> plugin-web-extension/feature-scripts/contracts',
  'plugin-js-frameworks -> plugin-web-extension/feature-scripts/contracts',
  'plugin-reload -> plugin-playwright',
  'plugin-reload -> plugin-web-extension',
  'plugin-reload -> plugin-web-extension/feature-chunk-loading',
  'plugin-reload -> plugin-web-extension/feature-html',
  'plugin-reload -> plugin-web-extension/feature-manifest/manifest-lib/manifest',
  'plugin-reload -> plugin-web-extension/feature-scripts/__spec__/scripting-calling-styles',
  'plugin-reload -> plugin-web-extension/feature-scripts/contracts',
  'plugin-reload -> plugin-web-extension/feature-scripts/steps/add-content-script-wrapper/content-script-wrapper',
  'plugin-reload -> plugin-web-extension/shared/chunk-loading-target-extensions',
  'plugin-reload -> plugin-web-extension/shared/content-script-wrapper-extensions',
  'plugin-reload -> plugin-web-extension/shared/html-page-extensions',
  'plugin-reload -> plugin-web-extension/shared/kept-resource-extensions',
  'plugin-static-assets -> plugin-css',
  'plugin-static-assets -> plugin-js-frameworks',
  'plugin-web-extension -> plugin-css/css-lib/inline-content-script-css'
]

describe('what one plugin reads in another', () => {
  const found = reaches()

  it('is this list of product reaches and no other', () => {
    expect(found.product).toEqual(PRODUCT_REACHES.map(([reach]) => reach))
  })

  it('gives every product reach a reason', () => {
    for (const [reach, why] of PRODUCT_REACHES) {
      expect(why.length, reach).toBeGreaterThan(20)
    }
  })

  it('is this list of spec reaches and no other', () => {
    expect(found.spec).toEqual(SPEC_REACHES)
  })

  // web-extension builds the extension. It never handles a browser or a
  // reload, so it reads nothing of the two plugins that do.
  it('never leads from web-extension to the browsers or the reload plugin', () => {
    const leaks = [...found.product, ...found.spec].filter((reach) =>
      /^plugin-web-extension -> plugin-(?:browsers|reload)(?:\/|$)/.test(reach)
    )

    expect(leaks).toEqual([])
  })

  it('leads from the reload plugin to no plugin but web-extension', () => {
    const others = found.product
      .filter((reach) => reach.startsWith('plugin-reload -> '))
      .filter(
        (reach) => !reach.startsWith('plugin-reload -> plugin-web-extension/')
      )

    expect(others).toEqual([])
  })

  it('leads from the browsers plugin to the reload entry and nothing else', () => {
    expect(
      found.product.filter((reach) => reach.startsWith('plugin-browsers -> '))
    ).toEqual(['plugin-browsers -> plugin-reload'])
  })

  // The reload plugin keeps its own exact list of what it reads. Both lists
  // name the same files, so neither can drift from the other.
  it('agrees with the list the reload plugin keeps of itself', () => {
    const own = fs.readFileSync(
      path.join(developRoot, 'plugin-reload/__spec__/plugin-boundary.spec.ts'),
      'utf8'
    )
    const listedThere = [
      ...own.matchAll(/'(plugin-web-extension\/[a-z/-]+)'/g)
    ].map((match) => match[1])
    const listedHere = found.product
      .filter((reach) => reach.startsWith('plugin-reload -> '))
      .map((reach) => reach.slice('plugin-reload -> '.length))

    expect([...new Set(listedThere)].sort()).toEqual(listedHere)
  })
})
