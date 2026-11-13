import * as vm from 'node:vm'
import {describe, expect, it} from 'vitest'
import {
  closedOnSlash,
  EXTENSION_BASE_FROM_STACK,
  EXTENSION_BASE_GLOBAL,
  extensionBaseFromFile,
  extensionBaseGlobal,
  prependBehindTakeBlock,
  readTakeBlock,
  TAKE_BLOCK_OPEN,
  takeBlockOpen,
  TAKEN_EXTENSION_BASE,
  unlessExtensionAddress
} from '../extension-base-from-stack'

const BASE = 'moz-extension://0f0f0f0f-aaaa-bbbb-cccc-121212121212/'

// A page that patched every builtin a reader could hand the base to.
function patchedPage(extra: Record<string, unknown> = {}) {
  const context = vm.createContext({seen: [] as string[], ...extra})

  vm.runInContext(
    `(function () {
      var note = function (value) {
        if (typeof value === "string" && value.indexOf("moz-extension:") === 0) seen.push(value)
      }
      var wrap = function (owner, name) {
        var original = owner[name]
        owner[name] = function () {
          note(this)
          for (var i = 0; i < arguments.length; i++) note(arguments[i])
          return original.apply(this, arguments)
        }
      }
      wrap(String.prototype, "replace")
      wrap(String.prototype, "charAt")
      wrap(String.prototype, "match")
      wrap(RegExp.prototype, "exec")
      var NativeString = String
      String = function (value) { note(value); return NativeString(value) }
      String.prototype = NativeString.prototype
    })()`,
    context
  )

  return context as vm.Context & {seen: string[]}
}

describe('the statement a Gecko MAIN world file opens on', () => {
  it('reads the published name bare, with no call a page could have patched', () => {
    expect(TAKE_BLOCK_OPEN).toBe(
      `{let ${TAKEN_EXTENSION_BASE}="";try{${TAKEN_EXTENSION_BASE}=${EXTENSION_BASE_GLOBAL}}catch(error){}if(typeof ${TAKEN_EXTENSION_BASE}!=="string"||${TAKEN_EXTENSION_BASE}<"moz-extension://"||${TAKEN_EXTENSION_BASE}>="moz-extension:/0")${TAKEN_EXTENSION_BASE}="";`
    )

    expect(TAKE_BLOCK_OPEN).not.toContain('\n')
    expect(TAKE_BLOCK_OPEN).not.toContain('(error)(')
    expect(TAKE_BLOCK_OPEN.split('(')).toHaveLength(3)
  })

  it('takes what the getter answers and hands nothing to the page', () => {
    const page = patchedPage()
    Object.defineProperty(page, EXTENSION_BASE_GLOBAL, {
      get: () => BASE,
      configurable: true
    })

    const taken = vm.runInContext(
      `${TAKE_BLOCK_OPEN}${TAKEN_EXTENSION_BASE}\n}`,
      page
    )

    expect(taken).toBe(BASE)
    expect(page.seen).toEqual([])
  })

  it('takes an empty string where the name is absent, throws or is no string', () => {
    const run = (page: vm.Context) =>
      vm.runInContext(`${TAKE_BLOCK_OPEN}${TAKEN_EXTENSION_BASE}\n}`, page)

    expect(run(patchedPage())).toBe('')

    const throwing = patchedPage()
    Object.defineProperty(throwing, EXTENSION_BASE_GLOBAL, {
      get: () => {
        throw new Error('page getter')
      }
    })

    expect(run(throwing)).toBe('')

    expect(
      run(patchedPage({[EXTENSION_BASE_GLOBAL]: {toString: () => BASE}}))
    ).toBe('')
  })
})

describe('the base a reader inside the file starts from', () => {
  it('is the copy the file took on Gecko, ahead of its own stack', () => {
    const page = patchedPage()
    const read = vm.runInContext(
      `${TAKE_BLOCK_OPEN}${TAKEN_EXTENSION_BASE} = ${JSON.stringify(BASE)};${extensionBaseFromFile(true)}\n}`,
      page
    )

    expect(read).toBe(BASE)
    expect(page.seen).toEqual([])
  })

  it('falls to the stack where the file took nothing, and where no file took at all', () => {
    expect(
      vm.runInNewContext(`${TAKE_BLOCK_OPEN}${extensionBaseFromFile(true)}\n}`)
    ).toBe('')

    expect(vm.runInNewContext(extensionBaseFromFile(true))).toBe('')
  })

  it('stays the stack read alone for a browser that names the file there', () => {
    expect(extensionBaseFromFile(false)).toBe(EXTENSION_BASE_FROM_STACK)
    expect(extensionBaseFromFile(false)).not.toContain(TAKEN_EXTENSION_BASE)
  })

  it('closes on one slash by index, through no patched method', () => {
    const page = patchedPage({open: BASE.slice(0, -1), closed: BASE})

    expect(vm.runInContext(closedOnSlash('open'), page)).toBe(BASE)
    expect(vm.runInContext(closedOnSlash('closed'), page)).toBe(BASE)
    expect(page.seen).toEqual([])
  })
})

describe('prependBehindTakeBlock', () => {
  it('puts the text ahead of a file that takes no base', () => {
    expect(prependBehindTakeBlock('body()', 'relay();\n')).toBe(
      'relay();\nbody()'
    )
  })

  it('puts the text behind the read of a file that takes the base', () => {
    const file = `${TAKE_BLOCK_OPEN}body()\n}`
    const prepended = prependBehindTakeBlock(file, 'relay();\n')

    expect(prepended).toBe(`${TAKE_BLOCK_OPEN}relay();\nbody()\n}`)
    expect(prepended.startsWith(TAKE_BLOCK_OPEN)).toBe(true)
  })

  it('keeps the read first through any number of prepends', () => {
    let file = `${TAKE_BLOCK_OPEN}body()\n}`

    for (const prefix of ['one();\n', 'two();\n', 'three();\n']) {
      file = prependBehindTakeBlock(file, prefix)
    }

    expect(file).toBe(`${TAKE_BLOCK_OPEN}three();\ntwo();\none();\nbody()\n}`)
  })
})

describe('the global one extension publishes its base under', () => {
  it('is its own for each extension and the same for every build of one', () => {
    const first = extensionBaseGlobal('a@example.com\nFirst\n')
    const second = extensionBaseGlobal('b@example.com\nSecond\n')

    expect(first).toMatch(/^__EXTJS_EXTENSION_BASE_[0-9a-f]{8}__$/)
    expect(second).toMatch(/^__EXTJS_EXTENSION_BASE_[0-9a-f]{8}__$/)
    expect(first).not.toBe(second)
    expect(extensionBaseGlobal('a@example.com\nFirst\n')).toBe(first)
  })

  it('is read by the block a file of that extension opens on, on one line', () => {
    const global = extensionBaseGlobal('a@example.com\nFirst\n')
    const open = takeBlockOpen(global)

    expect(open).toContain(`=${global}}catch`)
    expect(open).not.toContain('\n')
    expect(open.split('(')).toHaveLength(3)
    expect(readTakeBlock(`${open}body()\n}`)).toBe(open)
    expect(readTakeBlock(`${TAKE_BLOCK_OPEN}body()\n}`)).toBe(TAKE_BLOCK_OPEN)
    expect(readTakeBlock('body()')).toBeNull()
    expect(
      readTakeBlock(open.replace(global, '__EXTJS_EXTENSION_BASE_forged__'))
    ).toBeNull()
  })

  it('keeps a later prefix behind the read of either name', () => {
    const open = takeBlockOpen(extensionBaseGlobal('a@example.com\nFirst\n'))

    expect(prependBehindTakeBlock(`${open}body()\n}`, 'relay();\n')).toBe(
      `${open}relay();\nbody()\n}`
    )
  })

  it('hands each of two files on one page the base of its own extension', () => {
    const first = extensionBaseGlobal('a@example.com\nFirst\n')
    const second = extensionBaseGlobal('b@example.com\nSecond\n')
    const other = 'moz-extension://1a1a1a1a-aaaa-bbbb-cccc-343434343434/'
    const page = vm.createContext({[first]: BASE, [second]: other})
    const take = (global: string) =>
      vm.runInContext(
        `${takeBlockOpen(global)}${TAKEN_EXTENSION_BASE}\n}`,
        page
      )

    expect(take(first)).toBe(BASE)
    expect(take(second)).toBe(other)
    expect(take(first)).toBe(BASE)
  })
})

describe('a value a page put where the base is read', () => {
  const taken = (value: unknown) =>
    vm.runInNewContext(`${TAKE_BLOCK_OPEN}${TAKEN_EXTENSION_BASE}\n}`, {
      [EXTENSION_BASE_GLOBAL]: value
    })

  it('is taken only when it is an extension address', () => {
    expect(taken(BASE)).toBe(BASE)

    for (const forged of [
      'https://evil.example/',
      'moz-extension:',
      'moz-extension:/0',
      'moz-extensions://x/',
      'Moz-extension://x/',
      ' moz-extension://x/',
      '',
      42,
      null,
      {toString: () => BASE}
    ]) {
      expect(taken(forged), String(forged)).toBe('')
    }
  })

  it('is dropped by a reader of the document copy the same way', () => {
    const read = (value: unknown) =>
      vm.runInNewContext(`${unlessExtensionAddress('base')};base`, {
        base: value
      })

    expect(read(BASE)).toBe(BASE)
    expect(read('https://evil.example/')).toBe('')
    expect(read('chrome-extension://abc/')).toBe('')
    expect(read(42)).toBe('')
  })

  it('is compared, never handed to a method the page could have patched', () => {
    const page = patchedPage({base: BASE})

    expect(
      vm.runInContext(`${unlessExtensionAddress('base')};base`, page)
    ).toBe(BASE)

    expect(page.seen).toEqual([])
  })
})
