import * as fs from 'node:fs'
import * as path from 'node:path'
import * as vm from 'node:vm'
import {describe, expect, it} from 'vitest'

const BASE = 'moz-extension://0f0f0f0f-aaaa-bbbb-cccc-121212121212/'
const KEY = '__EXTJS_EXTENSION_BASE__'
const ATTRIBUTE = 'data-extjs-extension-base'
const BRIDGE_FRAME = `answer@${BASE}scripts/extjs-main-world-bridge.js:114:38`
const TAKE = '@<anonymous code>:1:44'
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

interface Setup {
  // The page window as the bridge reaches it, absent on Chromium.
  page?: Record<string, unknown> | null
  exports?: boolean
  // The stack the bridge reads of itself as it publishes.
  own?: string
  // The root the runtime names, the Firefox one unless given.
  root?: string
  // The page global the build named for this extension, null for none.
  global?: string | null
  // The attribute the build named for this extension.
  attribute?: string
  // The document the bridge writes on, one of its own unless given.
  attributes?: Record<string, string>
}

// The bridge in a stand-in for its isolated world, each stack scripted.
function bridge(setup: Setup = {}) {
  const attributes: Record<string, string> = setup.attributes ?? {}
  const page = setup.page === undefined ? {} : setup.page
  const stacks: Array<string | Error> = [
    setup.own ??
      `publishToInjectedFile@${BASE}scripts/extjs-main-world-bridge.js:101:17\n`
  ]
  const listening: string[] = []
  const root = setup.root ?? BASE
  const context: Record<string, unknown> = {
    browser: {
      runtime: {getURL: (relative: string) => root + relative.slice(1)}
    },
    document: {
      documentElement: {
        setAttribute: (name: string, value: string) => {
          attributes[name] = value
        }
      }
    },
    addEventListener: (type: string) => {
      listening.push(type)
    },
    postMessage() {},
    Error: function ScriptedError(this: {stack?: string}) {
      const next = stacks.shift()
      if (next instanceof Error) throw next

      this.stack = next
    }
  }

  if (page) context.wrappedJSObject = page

  // A Firefox build always names one, the shared name at the very least.
  if (setup.global !== null) {
    context.__EXTJS_PAGE_BASE_GLOBAL__ = setup.global ?? KEY
  }

  if (setup.attribute) {
    context.__EXTJS_PAGE_BASE_ATTRIBUTE__ = setup.attribute
  }

  if (setup.exports !== false) {
    context.exportFunction = (callable: unknown) => callable
  }

  context.window = context
  context.globalThis = context
  vm.runInNewContext(SOURCE, context)

  return {
    context,
    listening,
    attributes,
    page: page as Record<string, unknown>,
    // What a read of the name answers under the caller frames given.
    read: (...callers: string[]) => {
      stacks.push([BRIDGE_FRAME, ...callers, ''].join('\n'))

      return (page as Record<string, unknown>)[KEY]
    },
    failing: (error: Error) => {
      stacks.push(error)

      return (page as Record<string, unknown>)[KEY]
    }
  }
}

describe('the getter the bridge publishes on a Firefox page window', () => {
  it('answers the first statement of an injected file, and writes nothing on <html>', () => {
    const world = bridge()
    const held = Object.getOwnPropertyDescriptor(world.page, KEY)

    expect(typeof held?.get).toBe('function')
    expect(held?.set).toBeUndefined()
    expect(held?.enumerable).toBe(false)
    expect(held?.configurable).toBe(true)
    expect(Object.keys(world.page)).toEqual([])

    expect(world.read(TAKE)).toBe(BASE)
    expect(world.read('@<anonymous code>:1:227')).toBe(BASE)
    expect(world.attributes).toEqual({})
  })

  it('reads as an empty string from every other place', () => {
    const world = bridge()

    for (const callers of [
      [],
      ['@<anonymous code>:2:5'],
      ['@<anonymous code>:1:228'],
      ['@<anonymous code>:31:9'],
      ['@<anonymous code>:1:44', '@<anonymous code>:38:3'],
      ['@<anonymous code>:1:44', '@http://127.0.0.1/adv.js:9:1'],
      ['read@<anonymous code>:1:44'],
      ['@http://127.0.0.1/adv.js:1:44'],
      ['@<anonymous:1:44'],
      ['@<anonymous code> line 3 > eval:1:44'],
      ['@debugger eval code:1:44'],
      ['@<anonymous code>:1:44:1'],
      ['replace@[native code]', '@<anonymous code>:1:44']
    ]) {
      expect(world.read(...callers), callers.join(' | ')).toBe('')
    }

    expect(world.attributes).toEqual({})
  })

  it('answers nothing through a getter the page swapped for its own', () => {
    const world = bridge()
    const published = Object.getOwnPropertyDescriptor(world.page, KEY)
      ?.get as () => string

    Object.defineProperty(world.page, KEY, {
      get: () => published(),
      configurable: true
    })

    expect(world.read(TAKE)).toBe('')

    delete world.page[KEY]
    world.read(TAKE)

    expect(published()).toBe('')
    expect(world.attributes).toEqual({})
  })

  it('answers nothing when reading its own stack throws', () => {
    const world = bridge()

    expect(world.failing(new RangeError('too much recursion'))).toBe('')
    expect(world.attributes).toEqual({})
    expect(world.read(TAKE)).toBe(BASE)
  })
})

describe('the <html> attribute the bridge falls back to', () => {
  it('carries the base where there is no page window to publish on', () => {
    expect(bridge({page: null}).attributes).toEqual({[ATTRIBUTE]: BASE})
    expect(bridge({exports: false}).attributes).toEqual({[ATTRIBUTE]: BASE})
  })

  it('carries the base when the page defined the name first and locked it', () => {
    const page: Record<string, unknown> = {}
    Object.defineProperty(page, KEY, {value: 'page', configurable: false})

    const world = bridge({page})

    expect(world.attributes).toEqual({[ATTRIBUTE]: BASE})
    expect(world.page[KEY]).toBe('page')
  })

  it('carries the base when the bridge cannot read its own frame in the stack', () => {
    for (const own of [
      '',
      '@<anonymous code>:101:17\n',
      `publishToInjectedFile@${BASE}scripts/extjs-main-world-bridge.js line 101\n`
    ]) {
      expect(bridge({own}).attributes, own).toEqual({[ATTRIBUTE]: BASE})
    }
  })

  it('carries the base once the read that takes it comes from a file the browser named another way', () => {
    const world = bridge()

    expect(world.read('@<injected script>:1:44')).toBe('')
    expect(world.attributes).toEqual({[ATTRIBUTE]: BASE})
  })

  it('is not written for a source a page script can spell', () => {
    const world = bridge()

    for (const source of [
      'forged.js',
      '<anonymous',
      '<forged-label>',
      'http://127.0.0.1/a file.js',
      'blob:http://127.0.0.1/0f0f',
      'a/b c.js',
      'debugger eval code',
      'forged line 3 > eval',
      '<anonymous code> line 3 > eval',
      '<injected script> line 1 > Function'
    ]) {
      expect(world.read(`@${source}:1:44`), source).toBe('')
    }

    for (const callers of [
      ['@<injected script>:2:44'],
      ['@<injected script>:1:228'],
      ['@<injected script>:1:44', '@http://127.0.0.1/adv.js:9:1']
    ]) {
      expect(world.read(...callers), callers.join(' | ')).toBe('')
    }

    expect(world.attributes).toEqual({})
  })

  it('is not written through a getter the page swapped for its own', () => {
    const world = bridge()
    const published = Object.getOwnPropertyDescriptor(world.page, KEY)
      ?.get as () => string

    Object.defineProperty(world.page, KEY, {
      get: () => published(),
      configurable: true
    })

    expect(world.read('@<injected script>:1:44')).toBe('')
    expect(world.attributes).toEqual({})
  })
})

describe('the request to load a file a page can post to the bridge', () => {
  it('is not listened for on Firefox, where the answer would carry the extension URL', () => {
    expect(bridge().listening).toEqual([])
    expect(bridge({page: null}).listening).toEqual([])
    expect(bridge({exports: false}).listening).toEqual([])
  })

  it('is still answered where the extension URL is no secret of the install', () => {
    expect(
      bridge({page: null, root: 'chrome-extension://abcdefghijklmnop/'})
        .listening
    ).toEqual(['message'])
  })
})

describe('the getters two extensions publish on one page', () => {
  const FIRST = '__EXTJS_EXTENSION_BASE_1a2b3c4d__'
  const SECOND = '__EXTJS_EXTENSION_BASE_5e6f7a8b__'
  const OTHER = 'moz-extension://1a1a1a1a-aaaa-bbbb-cccc-343434343434/'
  const stack = (base: string) =>
    `publishToInjectedFile@${base}scripts/extjs-main-world-bridge.js:101:17\n`

  it('stand under the name each build gave, neither over the other', () => {
    for (const order of [
      [FIRST, SECOND],
      [SECOND, FIRST]
    ]) {
      const page: Record<string, unknown> = {}

      for (const global of order) {
        const base = global === FIRST ? BASE : OTHER

        bridge({page, global, root: base, own: stack(base)})
      }

      const names = Object.getOwnPropertyNames(page).sort()

      expect(names).toEqual([FIRST, SECOND].sort())
      expect(Object.getOwnPropertyDescriptor(page, FIRST)?.get).not.toBe(
        Object.getOwnPropertyDescriptor(page, SECOND)?.get
      )

      expect(page).not.toHaveProperty(KEY)
    }
  })

  it('writes the base under no global of its own world', () => {
    const page: Record<string, unknown> = {}
    const context = bridge({page, global: FIRST}).context

    expect(Object.keys(context)).not.toContain(KEY)
    expect(context[KEY]).toBeUndefined()
    expect(SOURCE).not.toContain('window[EXTJS_BASE_KEY]')
  })

  it('publishes on the document alone where the build named no global', () => {
    const world = bridge({global: null})

    expect(Object.getOwnPropertyNames(world.page)).toEqual([])
    expect(world.attributes).toEqual({[ATTRIBUTE]: BASE})
    expect(SOURCE).not.toContain(KEY)
  })

  it('writes <html> for a page that locked the name of this extension', () => {
    const page: Record<string, unknown> = {}

    Object.defineProperty(page, FIRST, {
      value: 'https://evil.example/',
      configurable: false
    })

    const world = bridge({page, global: FIRST})

    expect(page[FIRST]).toBe('https://evil.example/')
    expect(world.attributes).toEqual({[ATTRIBUTE]: BASE})
  })

  it('writes each base under its own attribute for a page that locked both names', () => {
    const attributeOf = (global: string) =>
      `${ATTRIBUTE}-${global.slice(-10, -2)}`

    for (const order of [
      [FIRST, SECOND],
      [SECOND, FIRST]
    ]) {
      const page: Record<string, unknown> = {}
      const attributes: Record<string, string> = {}

      for (const global of order) {
        Object.defineProperty(page, global, {
          value: 'https://evil.example/',
          configurable: false
        })
      }

      for (const global of order) {
        const base = global === FIRST ? BASE : OTHER

        bridge({
          page,
          global,
          attribute: attributeOf(global),
          attributes,
          root: base,
          own: stack(base)
        })
      }

      // One document, two bridges: neither base stands where the other was.
      expect(attributes).toEqual({
        [attributeOf(FIRST)]: BASE,
        [attributeOf(SECOND)]: OTHER
      })
    }
  })
})
