import * as vm from 'node:vm'
import {rspack} from '@rspack/core'
import {describe, expect, it} from 'vitest'
import {
  EXTENSION_BASE_ATTRIBUTE,
  EXTENSION_BASE_GLOBAL,
  extensionBaseAttribute,
  extensionBaseGlobal,
  extensionSchemeFor
} from '../../../lib/extension-base-from-stack'
import {toRuntimeStylesheetModule} from '../../../plugin-css/css-lib/inline-content-script-css'
import AutoPublicPathRuntimeModule from '../../../plugin-reload/steps/setup-reload-strategy/webpack-target-webextension-fork/lib/webpack5/RuntimeModules/AutoPublicPath'
import BaseUriRuntimeModule from '../../../plugin-reload/steps/setup-reload-strategy/webpack-target-webextension-fork/lib/webpack5/RuntimeModules/BaseUri'
import PublicPathRuntimeModule from '../../../plugin-reload/steps/setup-reload-strategy/webpack-target-webextension-fork/lib/webpack5/RuntimeModules/PublicPath'
import {buildMainWorldBridgePairingSource} from '../scripts-lib/main-world-bridge-pairing'
import {baseUriRuntimeSource} from '../steps/add-base-uri-runtime-module'

// Two extensions share one document on Firefox, so every Gecko reader of
// the base names its own extension and asks no global a page could hold.
const GLOBAL = extensionBaseGlobal('a@example.com\nFirst\n')
const KEYED = extensionBaseAttribute(GLOBAL)
const OWN = 'moz-extension://0f0f0f0f-aaaa-bbbb-cccc-121212121212/'
const OTHER = 'moz-extension://1a1a1a1a-aaaa-bbbb-cccc-343434343434/'
const quoted = (name: string) => JSON.stringify(name)

// A page with one attribute per name, and whatever globals it holds.
function documentWith(attributes: Record<string, string>) {
  return {
    documentElement: {
      getAttribute: (name: string) => attributes[name] ?? null
    }
  }
}

function baseUri(
  gecko: boolean,
  attribute: string | undefined,
  world: Record<string, unknown>,
  scheme?: string
) {
  const context: Record<string, unknown> = {out: {}, ...world}
  context.globalThis = context

  vm.runInNewContext(
    baseUriRuntimeSource('out.b', gecko, attribute, scheme).join('\n'),
    context
  )

  return (context.out as {b?: string}).b
}

// What a reload runtime module writes into a bundle.
function generated(module: unknown) {
  Object.assign(module as object, {
    chunk: {canBeInitial: () => true},
    compilation: {
      hash: 'abcd',
      outputOptions: {
        publicPath: '/',
        path: '/out',
        filename: '[name].js',
        environment: {const: true, optionalChaining: true}
      },
      getPath: (value: string) => value
    }
  })

  return String((module as {generate: () => string}).generate())
}

describe('the base URI a Gecko file reads off the document', () => {
  it('reads the attribute of its own extension and never the shared names', () => {
    const source = baseUriRuntimeSource('out.b', true, KEYED).join('\n')

    expect(source).toContain(`getAttribute(${quoted(KEYED)})`)
    expect(source).not.toContain(quoted(EXTENSION_BASE_ATTRIBUTE))
    expect(source).not.toContain(EXTENSION_BASE_GLOBAL)

    expect(
      baseUri(true, KEYED, {
        [EXTENSION_BASE_GLOBAL]: OTHER,
        document: documentWith({
          [EXTENSION_BASE_ATTRIBUTE]: OTHER,
          [KEYED]: OWN
        })
      })
    ).toBe(OWN)
  })

  it('takes nothing another extension or the page left under the shared names', () => {
    const page = {
      [EXTENSION_BASE_GLOBAL]: OTHER,
      document: {
        ...documentWith({[EXTENSION_BASE_ATTRIBUTE]: OTHER}),
        baseURI: 'https://example.com/page'
      }
    }

    expect(baseUri(true, KEYED, page)).toBe('https://example.com/page')
  })

  it('drops a document copy that is no extension address', () => {
    for (const forged of [
      'https://evil.example/',
      'chrome-extension://abcdefghijklmnop/',
      'moz-extension:',
      'javascript:alert(1)'
    ]) {
      expect(
        baseUri(true, KEYED, {
          document: {
            ...documentWith({[KEYED]: forged}),
            baseURI: 'https://example.com/page'
          }
        }),
        forged
      ).toBe('https://example.com/page')
    }
  })

  it('keeps every other browser off the global and off the Gecko scheme', () => {
    const chromium = baseUriRuntimeSource('out.b', false, KEYED).join('\n')

    expect(chromium).toContain(`getAttribute(${quoted(KEYED)})`)
    expect(chromium).not.toContain(quoted(EXTENSION_BASE_ATTRIBUTE))
    expect(chromium).not.toContain(EXTENSION_BASE_GLOBAL)
    expect(chromium).not.toContain('moz-extension:')
  })

  it('takes no base from a global the page set, on any browser', () => {
    for (const gecko of [false, true]) {
      expect(
        baseUri(gecko, gecko ? KEYED : undefined, {
          [EXTENSION_BASE_GLOBAL]: 'https://evil.example/',
          document: {
            ...documentWith({}),
            baseURI: 'https://example.com/page'
          }
        })
      ).toBe('https://example.com/page')
    }
  })
})

describe('the inline stylesheet module of a Gecko build', () => {
  const css = '.a { background: url("/img/bg.png"); }'

  it('reads the attribute of its own extension and no shared name', () => {
    const gecko = toRuntimeStylesheetModule(css, [], undefined, true, KEYED)

    expect(gecko).toContain(`getAttribute(${quoted(KEYED)})`)
    expect(gecko).not.toContain(quoted(EXTENSION_BASE_ATTRIBUTE))
    expect(gecko).not.toContain(EXTENSION_BASE_GLOBAL)
    expect(gecko).toContain('base < "moz-extension://"')
  })

  it('reads the attribute of its own extension on every other browser too', () => {
    const chromium = toRuntimeStylesheetModule(css, [], undefined, false, KEYED)

    expect(chromium).not.toContain(EXTENSION_BASE_GLOBAL)
    expect(chromium).toContain(`getAttribute(${quoted(KEYED)})`)
    expect(chromium).not.toContain(quoted(EXTENSION_BASE_ATTRIBUTE))
    expect(chromium).toContain('base < "chrome-extension://"')
    expect(chromium).not.toContain('moz-extension:')
  })
})

describe('the reload runtime modules of a Gecko build', () => {
  const webpack = rspack as unknown as typeof import('webpack')

  it('read the attribute of their own extension and no shared name', () => {
    for (const source of [
      generated(BaseUriRuntimeModule(webpack, true, KEYED)),
      generated(PublicPathRuntimeModule(webpack, true, KEYED))
    ]) {
      expect(source).toContain(`getAttribute(${quoted(KEYED)})`)
      expect(source).not.toContain(quoted(EXTENSION_BASE_ATTRIBUTE))
      expect(source).not.toContain(EXTENSION_BASE_GLOBAL)
      expect(source).toContain('__extjsBase < "moz-extension://"')
    }
  })

  it('ask no runtime for the public path in a file that took its base', () => {
    const source = generated(PublicPathRuntimeModule(webpack, true, KEYED))

    expect(source).toContain('if (typeof __extjsTakenBase !== "string" && ')
    expect(source).toContain('__extjsRuntimePath < "moz-extension://"')
  })

  it('keep every other browser off the global and off the Gecko scheme', () => {
    for (const build of [
      BaseUriRuntimeModule,
      PublicPathRuntimeModule,
      AutoPublicPathRuntimeModule
    ]) {
      const chromium = generated(build(webpack, false, KEYED))

      expect(chromium).toContain(`getAttribute(${quoted(KEYED)})`)
      expect(chromium).not.toContain(quoted(EXTENSION_BASE_ATTRIBUTE))
      expect(chromium).not.toContain(EXTENSION_BASE_GLOBAL)
      expect(chromium).not.toContain('__extjsTakenBase')
      expect(chromium).not.toContain('moz-extension:')
    }
  })
})

// Each engine serves an extension under one scheme, and two extensions
// share one document on all of them.
describe('the base a file of any engine reads off the document', () => {
  const webpack = rspack as unknown as typeof import('webpack')
  const CHROME = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/'
  const SAFARI = 'safari-web-extension://2D3F5E1A-0000-4000-8000-000000000000/'
  const PAGE = 'https://example.com/page'
  const engines = [
    {browser: 'chrome', scheme: 'chrome-extension', own: CHROME},
    {browser: 'firefox', scheme: 'moz-extension', own: OWN},
    {browser: 'safari', scheme: 'safari-web-extension', own: SAFARI}
  ]
  const read = (
    scheme: string,
    attributes: Record<string, string>
  ): string | undefined =>
    baseUri(
      scheme === 'moz-extension',
      KEYED,
      {document: {...documentWith(attributes), baseURI: PAGE}},
      scheme
    )

  it('names one scheme for each build target', () => {
    for (const {browser, scheme} of engines) {
      expect(extensionSchemeFor(browser)).toBe(scheme)
    }

    expect(extensionSchemeFor('edge')).toBe('chrome-extension')
    expect(extensionSchemeFor('chromium-based')).toBe('chrome-extension')
    expect(extensionSchemeFor('gecko-based')).toBe('moz-extension')
  })

  it('takes the base its own bridge wrote, in the scheme of its engine', () => {
    for (const {scheme, own} of engines) {
      expect(read(scheme, {[KEYED]: own}), scheme).toBe(own)
    }
  })

  it('takes nothing another extension left under the shared name', () => {
    for (const {scheme, own} of engines) {
      expect(read(scheme, {[EXTENSION_BASE_ATTRIBUTE]: own}), scheme).toBe(PAGE)
    }
  })

  it('drops the word a runtime that could not answer left there', () => {
    for (const {scheme} of engines) {
      for (const left of ['undefined', 'null', '', '/']) {
        expect(read(scheme, {[KEYED]: left}), `${scheme} ${left}`).toBe(PAGE)
      }
    }
  })

  it('drops a base in the scheme of any other engine', () => {
    for (const {scheme} of engines) {
      for (const other of engines) {
        if (other.scheme === scheme) continue

        expect(
          read(scheme, {[KEYED]: other.own}),
          `${scheme} ${other.scheme}`
        ).toBe(PAGE)
      }
    }
  })

  it('checks the scheme in the inline sheet and in every reload module', () => {
    for (const {scheme} of engines) {
      const gecko = scheme === 'moz-extension'
      const from = `< ${quoted(`${scheme}://`)}`
      const sheet = toRuntimeStylesheetModule(
        '.a{}',
        [],
        undefined,
        gecko,
        KEYED,
        scheme
      )

      expect(sheet, scheme).toContain(`base ${from}`)
      expect(sheet, scheme).toContain(`getAttribute(${quoted(KEYED)})`)

      for (const build of [
        BaseUriRuntimeModule,
        PublicPathRuntimeModule,
        AutoPublicPathRuntimeModule
      ]) {
        const source = generated(build(webpack, gecko, KEYED, scheme))

        expect(source, scheme).toContain(`__extjsBase ${from}`)
        expect(source, scheme).toContain(`getAttribute(${quoted(KEYED)})`)
        // The text has to be a script before anything else holds for it.
        expect(() => new Function(source), scheme).not.toThrow()
      }

      for (const build of [
        PublicPathRuntimeModule,
        AutoPublicPathRuntimeModule
      ]) {
        expect(generated(build(webpack, gecko, KEYED, scheme))).toContain(
          `base ${from}`
        )
      }
    }
  })

  it('keeps the script URL of its own engine and no other in an auto public path', () => {
    const source = generated(
      AutoPublicPathRuntimeModule(webpack, false, KEYED, 'safari-web-extension')
    )

    expect(source).toContain(
      'String(scriptUrl).indexOf("safari-web-extension://") !== 0'
    )

    expect(source).not.toContain('chrome|moz')
  })
})

describe('the sweep a Gecko caller runs after a failed injection', () => {
  it('removes the attribute of its own extension', () => {
    const keyed = buildMainWorldBridgePairingSource(
      'bridge.js',
      null,
      null,
      GLOBAL
    )

    expect(keyed).toContain(`removeAttribute(${quoted(KEYED)})`)
    expect(keyed).not.toContain(quoted(EXTENSION_BASE_ATTRIBUTE))
    expect(buildMainWorldBridgePairingSource('bridge.js')).toContain(
      `removeAttribute(${quoted(EXTENSION_BASE_ATTRIBUTE)})`
    )
  })
})
