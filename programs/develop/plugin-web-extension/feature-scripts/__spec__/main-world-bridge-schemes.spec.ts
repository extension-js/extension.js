import * as fs from 'node:fs'
import * as path from 'node:path'
import * as vm from 'node:vm'
import {describe, expect, it} from 'vitest'

const SOURCE = fs.readFileSync(
  path.join(
    __dirname,
    '..',
    'steps',
    'add-content-script-wrapper',
    'main-world-bridge.js'
  ),
  'utf-8'
)
const SHARED = 'data-extjs-extension-base'
const KEYED = 'data-extjs-extension-base-0a1b2c3d'
const CHROME = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/'
const FIREFOX = 'moz-extension://0f0f0f0f-aaaa-bbbb-cccc-121212121212/'
const SAFARI = 'safari-web-extension://2D3F5E1A-0000-4000-8000-000000000000/'
const ENGINES = [
  {scheme: 'chrome-extension', root: CHROME},
  {scheme: 'moz-extension', root: FIREFOX},
  {scheme: 'safari-web-extension', root: SAFARI}
]

// A runtime the way Safari 27 has it: getURL answers only when it is called
// on its runtime, and gives undefined, without throwing, to any other call.
function boundRuntime(root: string, calls: unknown[] = []) {
  const runtime = {
    getURL(this: unknown, relative: string) {
      calls.push(this)

      return this === runtime ? root + String(relative).slice(1) : undefined
    }
  }

  return runtime
}

interface Setup {
  // The scheme the build named for its engine, none for a build that did not.
  scheme?: string
  attribute?: string
  browser?: unknown
  chrome?: unknown
}

interface Answer {
  ok: boolean
  error?: string
}

// The bridge in a stand-in for the isolated world of a page with no window
// to publish on, which is every engine but Firefox.
function bridge(setup: Setup) {
  const attributes: Record<string, string> = {}
  const injected: string[] = []
  const answers: Answer[] = []
  const listeners: Array<(event: unknown) => void> = []
  const context: Record<string, unknown> = {
    document: {
      documentElement: {
        setAttribute: (name: string, value: string) => {
          attributes[name] = value
        },
        appendChild: (element: {src: string; onload: () => void}) => {
          injected.push(element.src)
          element.onload()
        }
      },
      createElement: () => ({remove() {}})
    },
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      if (type === 'message') listeners.push(listener)
    },
    postMessage: (answer: Answer) => {
      answers.push(answer)
    },
    URL
  }

  if (setup.browser !== undefined) context.browser = setup.browser
  if (setup.chrome !== undefined) context.chrome = setup.chrome
  if (setup.scheme) context.__EXTJS_EXTENSION_SCHEME__ = setup.scheme
  if (setup.attribute) context.__EXTJS_PAGE_BASE_ATTRIBUTE__ = setup.attribute

  context.window = context
  context.globalThis = context
  vm.createContext(context)
  vm.runInContext(SOURCE, context)
  // The window as the bridge names it, which is what a message comes from.
  const self = vm.runInContext('window', context)

  return {
    attributes,
    injected,
    listening: listeners.length > 0,
    // What the bridge answers a MAIN world file that asks for one URL.
    load: async (url: string) => {
      const before = answers.length

      for (const listener of listeners) {
        listener({
          source: self,
          data: {__extjs__: true, type: 'EXTJS_WTW_LOAD', requestId: 'r1', url}
        })
      }

      await new Promise((resolve) => setTimeout(resolve, 0))

      return answers[before]
    }
  }
}

describe('the base the bridge publishes on the document', () => {
  it('calls getURL on its runtime, the only call Safari answers', () => {
    const calls: unknown[] = []
    const runtime = boundRuntime(SAFARI, calls)
    const world = bridge({
      scheme: 'safari-web-extension',
      attribute: KEYED,
      browser: {runtime},
      chrome: {runtime}
    })

    expect(world.attributes).toEqual({[KEYED]: SAFARI})
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.every((self) => self === runtime)).toBe(true)
  })

  it('writes under the attribute of its own extension, never the shared one', () => {
    for (const {scheme, root} of ENGINES) {
      const first = bridge({
        scheme,
        attribute: KEYED,
        chrome: {runtime: boundRuntime(root)}
      })
      const second = bridge({
        scheme,
        attribute: `${SHARED}-99887766`,
        chrome: {runtime: boundRuntime(root)}
      })

      expect(first.attributes, scheme).toEqual({[KEYED]: root})
      expect(second.attributes, scheme).toEqual({
        [`${SHARED}-99887766`]: root
      })
    }
  })

  it('publishes nothing a runtime that could not answer gave back', () => {
    for (const {scheme} of ENGINES) {
      for (const answer of [undefined, null, '', 'undefined', 'null', '/']) {
        const world = bridge({
          scheme,
          attribute: KEYED,
          chrome: {runtime: {getURL: () => answer}}
        })

        expect(world.attributes, `${scheme} ${String(answer)}`).toEqual({})
      }
    }
  })

  it('publishes nothing when the runtime throws or is not there', () => {
    const throwing = {
      getURL: () => {
        throw new Error('Extension context invalidated.')
      }
    }

    for (const setup of [
      {chrome: {runtime: throwing}},
      {chrome: {runtime: {}}},
      {chrome: {}},
      {}
    ]) {
      const world = bridge({
        scheme: 'chrome-extension',
        attribute: KEYED,
        ...setup
      })

      expect(world.attributes).toEqual({})
    }
  })

  it('publishes no base in the scheme of another engine', () => {
    for (const {scheme} of ENGINES) {
      for (const other of ENGINES) {
        if (other.scheme === scheme) continue

        const world = bridge({
          scheme,
          attribute: KEYED,
          chrome: {runtime: boundRuntime(other.root)}
        })

        expect(world.attributes, `${scheme} ${other.scheme}`).toEqual({})
      }
    }
  })

  it('asks the next namespace when the first one has no getURL', () => {
    // An element with the id "browser" is what a page can put there.
    const world = bridge({
      scheme: 'chrome-extension',
      attribute: KEYED,
      browser: {nodeType: 1},
      chrome: {runtime: boundRuntime(CHROME)}
    })

    expect(world.attributes).toEqual({[KEYED]: CHROME})
  })
})

describe('the URL the bridge loads for a MAIN world file', () => {
  it('takes a Safari address in a Safari build, as it is', async () => {
    const world = bridge({
      scheme: 'safari-web-extension',
      attribute: KEYED,
      browser: {runtime: boundRuntime(SAFARI)}
    })

    expect(world.listening).toBe(true)
    expect(await world.load(`${SAFARI}chunks/lazy.js`)).toMatchObject({
      ok: true
    })

    expect(world.injected).toEqual([`${SAFARI}chunks/lazy.js`])
  })

  it('refuses a Safari address in a build for any other engine', async () => {
    const world = bridge({
      scheme: 'chrome-extension',
      attribute: KEYED,
      chrome: {runtime: boundRuntime(CHROME)}
    })

    expect(await world.load(`${SAFARI}chunks/lazy.js`)).toMatchObject({
      ok: false
    })

    expect(world.injected).toEqual([])
  })

  it('refuses the address of every other engine in a Safari build', async () => {
    const world = bridge({
      scheme: 'safari-web-extension',
      attribute: KEYED,
      browser: {runtime: boundRuntime(SAFARI)}
    })

    for (const foreign of [
      `${CHROME}chunks/lazy.js`,
      `${FIREFOX}chunks/lazy.js`,
      'https://evil.example/lazy.js',
      'data://text/javascript,alert(1)',
      'safari-extension://old/lazy.js',
      'safari-web-extension-evil://id/lazy.js'
    ]) {
      expect(await world.load(foreign), foreign).toMatchObject({ok: false})
    }

    expect(world.injected).toEqual([])
  })

  it('resolves a path on the runtime, bound, in every engine that loads files', async () => {
    for (const {scheme, root} of [ENGINES[0], ENGINES[2]]) {
      const world = bridge({
        scheme,
        attribute: KEYED,
        chrome: {runtime: boundRuntime(root)}
      })

      expect(await world.load('/chunks/lazy.js?x=1#y'), scheme).toMatchObject({
        ok: true
      })

      expect(await world.load('chunks/other.js'), scheme).toMatchObject({
        ok: true
      })

      expect(world.injected, scheme).toEqual([
        `${root}chunks/lazy.js`,
        `${root}chunks/other.js`
      ])
    }
  })

  it('loads nothing a runtime resolved to no extension address', async () => {
    let asked = 0
    const runtime = {
      // The base is answered once, then the runtime stops answering.
      getURL: () => (asked++ < 2 ? SAFARI : undefined)
    }
    const world = bridge({
      scheme: 'safari-web-extension',
      attribute: KEYED,
      browser: {runtime}
    })

    expect(world.attributes).toEqual({[KEYED]: SAFARI})
    expect(await world.load('/chunks/lazy.js')).toMatchObject({ok: false})
    expect(world.injected).toEqual([])
  })

  it('loads no file for the page on Firefox, whose address the page must not see', () => {
    const world = bridge({
      scheme: 'moz-extension',
      attribute: KEYED,
      browser: {runtime: boundRuntime(FIREFOX)}
    })

    expect(world.listening).toBe(false)
  })

  it('takes the scheme of any engine in a build that named none', async () => {
    const world = bridge({chrome: {runtime: boundRuntime(CHROME)}})

    expect(world.attributes).toEqual({[SHARED]: CHROME})
    expect(await world.load(`${SAFARI}a.js`)).toMatchObject({ok: true})
    expect(await world.load('https://evil.example/a.js')).toMatchObject({
      ok: false
    })
  })
})
