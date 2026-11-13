import * as vm from 'node:vm'
import {describe, expect, it} from 'vitest'
import {
  closedOnSlash,
  EXTENSION_BASE_FROM_STACK,
  EXTENSION_BASE_GLOBAL,
  extensionBaseFromFile,
  prependBehindTakeBlock,
  TAKE_BLOCK_OPEN,
  TAKEN_EXTENSION_BASE
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
      `{let ${TAKEN_EXTENSION_BASE}="";try{${TAKEN_EXTENSION_BASE}=${EXTENSION_BASE_GLOBAL}}catch(error){}if(typeof ${TAKEN_EXTENSION_BASE}!=="string")${TAKEN_EXTENSION_BASE}="";`
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
