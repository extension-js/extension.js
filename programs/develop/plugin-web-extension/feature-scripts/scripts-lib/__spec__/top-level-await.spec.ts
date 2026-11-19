import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {findTopLevelAwait, refuseTopLevelAwait} from '../top-level-await'

const JS = path.join('project', 'content', 'main.js')
const TS = path.join('project', 'content', 'main.ts')

describe('findTopLevelAwait', () => {
  it.each([
    ['an await statement', 'const a = 1\nawait fetch(a)\n', 2, 1],
    ['an await in an initializer', 'const a = 1, b = await a\n', 1, 18],
    [
      'a for await loop',
      'const list = []\n  for await (const one of list) {}\n',
      2,
      3
    ],
    ['an await using declaration', 'await using handle = open()\n', 1, 1],
    [
      'an await inside a block of the module body',
      'if (ready) {\n  try { await go() } catch {}\n}\n',
      2,
      9
    ],
    [
      'the first of two',
      'go()\nconst x = await one()\nconst y = await two()\n',
      2,
      11
    ],
    [
      'an await after a hashbang and CRLF line ends',
      '#!/usr/bin/env node\r\nconst x = await one()\r\n',
      2,
      11
    ]
  ])('finds %s', (_name, source, line, column) => {
    expect(findTopLevelAwait(source, JS)).toEqual({line, column})
  })

  it.each([
    [
      'an await in an async function',
      'async function a() { await b() }\na()\n'
    ],
    ['an await in an async arrow', 'const a = async () => await b()\n'],
    [
      'an await in a method',
      'const o = { async m() { await b() } }\nclass C { async m() { await b() } }\n'
    ],
    [
      'a for await loop in an async function',
      'async function a() { for await (const x of y) {} }\n'
    ],
    [
      'the word in a string, a template and comments',
      '// await one()\n/* await two() */\nconst s = "await three()" + `await ${"four"}`\n'
    ],
    ['await as a property name', 'const o = {await: 1}\no.await\n']
  ])('passes %s', (_name, source) => {
    expect(findTopLevelAwait(source, JS)).toBeUndefined()
  })

  // A module runs as an async module the bundler awaits for it.
  it.each([
    ['an import', 'import "./other.js"\nawait one()\n'],
    ['an export', 'await one()\nexport const two = 2\n'],
    [
      'a default export',
      'const x = await one()\nexport default function main() {}\n'
    ]
  ])('passes a file with %s', (_name, source) => {
    expect(findTopLevelAwait(source, JS)).toBeUndefined()
  })

  it('reads TypeScript as written, types and all', () => {
    const source =
      'interface Settings {\n  selector: string\n}\n' +
      'const settings = (await chrome.storage.sync.get({})) as Settings\n'

    expect(findTopLevelAwait(source, TS)).toEqual({line: 4, column: 19})
  })

  // The transpiler drops an import of types, which leaves a script.
  it('counts a TypeScript file whose imports are types only as a script', () => {
    const source =
      'import type {Settings} from "./settings"\n' +
      'const settings: Settings = await chrome.storage.sync.get({})\n'

    expect(findTopLevelAwait(source, TS)).toEqual({line: 2, column: 28})
  })

  it('leaves a file no parser reads to the error of the build', () => {
    expect(findTopLevelAwait('const = await (\n', JS)).toBeUndefined()
  })
})

describe('refuseTopLevelAwait', () => {
  function refusal(...args: Parameters<typeof refuseTopLevelAwait>) {
    try {
      refuseTopLevelAwait(...args)
    } catch (error) {
      return error as Error
    }

    return undefined
  }

  it('stops the build with a coded error that names the place and the fix', () => {
    const error = refusal(
      'const { selector } = await chrome.storage.sync.get({})\n',
      JS,
      'src/content/main.js',
      true
    )

    expect(error?.name).toBe('ContentScriptSyntax')
    expect(error?.stack).toBe(`ContentScriptSyntax: ${error?.message}`)
    expect(error?.message.split('\n')).toEqual([
      '⏵⏵⏵ Error: src/content/main.js uses await at the top level, outside any function.',
      'PATH src/content/main.js:1:22',
      'A content script declared in the manifest runs as a classic script, and a classic script only allows await inside an async function. This file has no import or export, so the build compiles it as that classic script too.',
      'Wrap the code in an async function that runs right away:',
      '  (async () => {',
      '    // the code that uses await',
      '  })()'
    ])
  })

  it('says how a file a scripting call injects runs', () => {
    expect(
      refusal('await one()\n', JS, 'scripts/inject.js', false)?.message
    ).toContain(
      'A file a scripting call injects runs as a classic script, and a classic script'
    )
  })

  it('names the line of the file as written when a loader moved it', () => {
    const error = refusal(
      '/* banner */\n/* banner */\nawait one()\n',
      JS,
      'src/content/main.js',
      true,
      () => 'await one()\n'
    )

    expect(error?.message).toContain('PATH src/content/main.js:1:1')
  })

  it('reads nothing from disk for a file that does not await', () => {
    let reads = 0

    expect(
      refusal('go()\n', JS, 'src/content/main.js', true, () => {
        reads++

        return 'go()\n'
      })
    ).toBeUndefined()

    expect(reads).toBe(0)
  })
})
