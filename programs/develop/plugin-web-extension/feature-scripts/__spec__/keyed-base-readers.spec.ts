import * as vm from 'node:vm'
import {rspack} from '@rspack/core'
import {describe, expect, it} from 'vitest'
import {
  EXTENSION_BASE_ATTRIBUTE,
  EXTENSION_BASE_GLOBAL,
  extensionBaseAttribute,
  extensionBaseGlobal
} from '../../../lib/extension-base-from-stack'
import {toRuntimeStylesheetModule} from '../../../plugin-css/css-lib/inline-content-script-css'
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
  world: Record<string, unknown>
) {
  const context: Record<string, unknown> = {out: {}, ...world}
  context.globalThis = context

  vm.runInNewContext(
    baseUriRuntimeSource('out.b', gecko, attribute).join('\n'),
    context
  )

  return (context.out as {b?: string}).b
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

  it('keeps every other browser on the shared attribute, and off the global', () => {
    const chromium = baseUriRuntimeSource('out.b').join('\n')

    expect(baseUriRuntimeSource('out.b', false, KEYED).join('\n')).toBe(
      chromium.split(quoted(EXTENSION_BASE_ATTRIBUTE)).join(quoted(KEYED))
    )

    expect(chromium).toContain(
      `getAttribute(${quoted(EXTENSION_BASE_ATTRIBUTE)})`
    )

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

  it('keeps every other browser on the shared attribute, and off the global', () => {
    const chromium = toRuntimeStylesheetModule(css, [], undefined, false)

    expect(chromium).not.toContain(EXTENSION_BASE_GLOBAL)

    expect(toRuntimeStylesheetModule(css, [], undefined, false, KEYED)).toBe(
      chromium
    )

    expect(chromium).toContain(
      `getAttribute(${quoted(EXTENSION_BASE_ATTRIBUTE)})`
    )
  })
})

describe('the reload runtime modules of a Gecko build', () => {
  const webpack = rspack as unknown as typeof import('webpack')

  const generated = (module: unknown) => {
    Object.assign(module as object, {
      compilation: {
        hash: 'abcd',
        outputOptions: {publicPath: '/'},
        getPath: (value: string) => value
      }
    })

    return String((module as {generate: () => string}).generate())
  }

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

  it('keep every other browser on the shared attribute, and off the global', () => {
    for (const build of [BaseUriRuntimeModule, PublicPathRuntimeModule]) {
      const chromium = generated(build(webpack, false))

      expect(generated(build(webpack, false, KEYED))).toBe(
        chromium.split(quoted(EXTENSION_BASE_ATTRIBUTE)).join(quoted(KEYED))
      )

      expect(chromium).not.toContain(EXTENSION_BASE_GLOBAL)
      expect(chromium).not.toContain('__extjsTakenBase')
      expect(chromium).not.toContain('moz-extension:')
    }
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
