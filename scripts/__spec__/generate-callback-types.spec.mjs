import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import {
  argumentChoices,
  callbackOverloads,
  chromeTypesFile,
  comparable,
  kindOf,
  OUTPUT_FILE,
  parseDeclarations,
  renderCallbackTypes,
  SPREAD_CALLBACKS
} from '../generate-callback-types.mjs'

// The shapes chrome-types writes: a promise form, then a callback form
// whose callback follows every optional argument.
const source = `
declare namespace browser {
  /** A comment with a brace { and a call( that are not code. */
  export namespace tabs {
    export interface Tab { id?: number; }
    export interface ImageDetails { format?: "jpeg" | "png"; }
    export type Mode = "fast" | "slow";

    export function getZoom(

      tabId?: number,
    ): Promise<number>;

    export function getZoom(

      tabId?: number,

      callback?: (
        zoomFactor: number,
      ) => void,
    ): void;

    export function query(
      queryInfo: {active?: boolean},
      callback?: (result: Tab[]) => void,
    ): void;

    export function sendMessage(
      tabId: number,
      message: any,
      options?: {frameId?: number},
      callback?: (response: any) => void,
    ): void;

    export function captureVisibleTab(
      windowId?: number,
      options?: ImageDetails,
      callback?: (dataUrl: string) => void,
    ): void;

    export function twoNumbers(
      first?: number,
      second?: number,
      callback?: () => void,
    ): void;

    export function loose(
      value?: any,
      callback?: () => void,
    ): void;

    export function byMode(
      mode?: Mode,
      label?: string,
      callback?: () => void,
    ): void;

    export function connect(tabId: number, info?: {name?: string}): Tab;
  }

  export namespace devtools.inspectedWindow {
    export {_eval as eval};

    export function _eval(
      expression: string,
      options?: {frameURL?: string},
      callback?: (
        response: {
          result: {[name: string]: any},
          exceptionInfo: {isError: boolean, value: string},
        },
      ) => void,
    ): void;
  }
}

declare namespace chrome {
  export namespace tabs {
    export function getZoom(tabId?: number, callback?: (zoomFactor: number) => void): void;
  }
}
`

function linesOf(namespace) {
  return Array.from(callbackOverloads(source).get(namespace) || [])
}

test('reads functions with their namespace, past comments and blank lines', () => {
  const {functions, interfaces, aliases} = parseDeclarations(source)
  const names = functions.map((fn) => `${fn.namespace}.${fn.name}`)

  assert.equal(
    names.filter((name) => name === 'browser.tabs.getZoom').length,
    2
  )

  assert.ok(names.includes('browser.devtools.inspectedWindow._eval'))
  assert.ok(names.includes('chrome.tabs.getZoom'))
  assert.ok(interfaces.has('ImageDetails'))
  assert.equal(aliases.get('Mode'), '"fast" | "slow"')
  assert.deepEqual(functions[0].parameters, [
    {name: 'tabId', optional: true, type: 'number'}
  ])

  assert.equal(functions[0].returns, 'Promise<number>')
})

test('adds the callback right after the required arguments', () => {
  const lines = linesOf('browser.tabs')

  assert.ok(
    lines.includes(
      'export function getZoom<F extends (zoomFactor: number) => void>(callback: ExtensionCallback<F>): void'
    )
  )

  assert.ok(
    lines.includes(
      'export function sendMessage<F extends (response: any) => void>(tabId: number, message: any, callback: ExtensionCallback<F>): void'
    )
  )

  assert.deepEqual(linesOf('chrome.tabs'), [
    'export function getZoom<F extends (zoomFactor: number) => void>(callback: ExtensionCallback<F>): void'
  ])
})

test('adds nothing where the declared form already takes the call', () => {
  const lines = linesOf('browser.tabs').join('\n')

  assert.equal(lines.includes('function query'), false)
  assert.equal(lines.includes('function connect'), false)
})

test('lets an optional argument be skipped only when its kind tells it apart', () => {
  const lines = linesOf('browser.tabs')
  const forms = (name) =>
    lines
      .filter((line) => line.includes(`function ${name}<`))
      .map((line) =>
        line.slice(line.indexOf('>(') + 2, line.indexOf('): void'))
      )

  assert.deepEqual(forms('captureVisibleTab'), [
    'callback: ExtensionCallback<F>',
    'windowId: number, callback: ExtensionCallback<F>',
    'options: ImageDetails, callback: ExtensionCallback<F>'
  ])

  assert.deepEqual(forms('twoNumbers'), [
    'callback: ExtensionCallback<F>',
    'first: number, callback: ExtensionCallback<F>'
  ])

  // Both are strings to the browser, one through its alias.
  assert.deepEqual(forms('byMode'), [
    'callback: ExtensionCallback<F>',
    'mode: Mode, callback: ExtensionCallback<F>'
  ])

  // A callback could be taken for the any argument, so none is added.
  assert.deepEqual(forms('loose'), [])
})

test('tells the kinds of arguments apart', () => {
  const declarations = parseDeclarations(source)

  assert.equal(kindOf('number', declarations), 'number')
  assert.equal(kindOf('"a" | "b"', declarations), 'string')
  assert.equal(kindOf('Mode', declarations), 'string')
  assert.equal(kindOf('{frameId?: number}', declarations), 'object')
  assert.equal(kindOf('extensionTypes.ImageDetails', declarations), 'object')
  assert.equal(kindOf('() => void', declarations), 'function')
  assert.equal(kindOf('any', declarations), 'unknown')
  assert.equal(kindOf('NotDeclared', declarations), 'unknown')
  assert.deepEqual(
    argumentChoices(
      [{name: 'value', optional: true, type: 'any'}],
      declarations
    ),
    []
  )
})

test('spreads the eval response into the arguments the browser passes', () => {
  assert.deepEqual(Object.keys(SPREAD_CALLBACKS), [
    'devtools.inspectedWindow._eval'
  ])

  assert.deepEqual(linesOf('browser.devtools.inspectedWindow'), [
    'export function _eval<T = unknown>(expression: string, callback: (result: T, exceptionInfo: {isError: boolean, value: string}) => void): void',
    'export function _eval<T = unknown>(expression: string, options: {frameURL?: string}, callback: (result: T, exceptionInfo: {isError: boolean, value: string}) => void): void'
  ])
})

test('compares two renderings by their tokens', () => {
  assert.equal(
    comparable('f(a: "x",\n  b: {c: 1; d: 2},\n)'),
    comparable("f(a: 'x', b: {c: 1, d: 2})")
  )

  assert.notEqual(comparable('f(a: number)'), comparable('f(a: string)'))
})

test('the published callbacks.d.ts matches the installed chrome-types', () => {
  const rendered = renderCallbackTypes(
    fs.readFileSync(chromeTypesFile(), 'utf8')
  )
  const published = fs.readFileSync(OUTPUT_FILE, 'utf8')

  assert.equal(
    comparable(published),
    comparable(rendered),
    'programs/extension/types/callbacks.d.ts is behind chrome-types. Run node scripts/generate-callback-types.mjs'
  )

  // A parser that stops reading the file would still match an empty output.
  const overloads = published.match(/export function /g) || []

  assert.ok(overloads.length >= 100, `${overloads.length} overloads`)
  assert.ok(published.includes('declare namespace chrome.tabs {'))
  assert.ok(published.includes('declare namespace browser.tabs {'))
})
