import {describe, expect, it} from 'vitest'
import {
  extractMainWorldRegisteredFileLiterals,
  extractRegisteredFileSightings
} from '../scripts-lib/registration-worlds'

const worldsOf = (source: string, file = 'scripts/hook.js') =>
  extractRegisteredFileSightings(source)
    .filter((sighting) => sighting.file === file)
    .map((sighting) => sighting.world)
    .sort()

describe('the world a scripting call gives each file', () => {
  it('reads one file registered in both worlds as both', () => {
    const source =
      'chrome.scripting.registerContentScripts([\n' +
      "  {id: 'iso', js: ['scripts/hook.js'], matches, world: 'ISOLATED'},\n" +
      "  {id: 'main', js: ['scripts/hook.js'], matches, world: 'MAIN'}\n" +
      '])\n'

    expect(worldsOf(source)).toEqual(['ISOLATED', 'MAIN'])
  })

  it('reads a registration with no world as the isolated world', () => {
    expect(
      worldsOf(
        "chrome.scripting.executeScript({target: {tabId}, files: ['scripts/hook.js']})"
      )
    ).toEqual(['ISOLATED'])
  })

  it('reads a map over a constant list whose element is the world', () => {
    const source =
      "const worlds = ['ISOLATED', 'MAIN']\n" +
      "chrome.scripting.registerContentScripts(worlds.map(world => ({id: 'h-' + world, js: ['scripts/hook.js'], matches: ['<all_urls>'], world})))\n"

    expect(worldsOf(source)).toEqual(['ISOLATED', 'MAIN'])
  })

  it('reads a map over a literal list, a named world and a block body', () => {
    const arrow =
      "chrome.scripting.registerContentScripts(['MAIN'].map((w, index) => ({id: 'h' + index, js: ['scripts/hook.js'], world: w})))\n"
    const block =
      "chrome.scripting.registerContentScripts(['ISOLATED', 'MAIN'].map(function (w) { return {id: w, js: ['scripts/hook.js'], world: w}; }))\n"

    expect(worldsOf(arrow)).toEqual(['MAIN'])
    expect(worldsOf(block)).toEqual(['ISOLATED', 'MAIN'])
  })

  it('reads a map over a list of files with a literal world', () => {
    const source =
      "const FILES = ['scripts/a.js', 'scripts/b.js']\n" +
      "chrome.scripting.registerContentScripts(FILES.map((file) => ({id: file, js: [file], matches, world: 'MAIN'})))\n"

    expect(extractMainWorldRegisteredFileLiterals(source).sort()).toEqual([
      'scripts/a.js',
      'scripts/b.js'
    ])
  })

  it('reads a mapped list held in a constant and passed by name', () => {
    const source =
      "const worlds = ['ISOLATED', 'MAIN']\n" +
      "const scripts = worlds.map((world) => ({id: world, js: ['scripts/hook.js'], matches, world}))\n" +
      'chrome.scripting.registerContentScripts(scripts)\n'

    expect(worldsOf(source)).toEqual(['ISOLATED', 'MAIN'])
  })

  it('reads a list of registrations held in a constant', () => {
    const source =
      'const scripts = [\n' +
      "  {id: 'iso', js: ['scripts/hook.js'], matches},\n" +
      "  {id: 'main', js: ['scripts/hook.js'], matches, world: 'MAIN'}\n" +
      ']\n' +
      'chrome.scripting.registerContentScripts(scripts)\n'

    expect(worldsOf(source)).toEqual(['ISOLATED', 'MAIN'])
  })

  it('reads a spread over a literal object, the later world winning', () => {
    const source =
      "const base = {js: ['scripts/hook.js'], matches: ['<all_urls>'], world: 'ISOLATED'}\n" +
      'chrome.scripting.registerContentScripts([\n' +
      "  {...base, id: 'iso'},\n" +
      "  {...base, id: 'main', world: 'MAIN'},\n" +
      "  {...{js: ['scripts/inline.js']}, id: 'inline', world: 'MAIN'}\n" +
      '])\n'

    expect(worldsOf(source)).toEqual(['ISOLATED', 'MAIN'])
    expect(worldsOf(source, 'scripts/inline.js')).toEqual(['MAIN'])
  })

  it('reads a choice between the two world literals as both worlds', () => {
    const source =
      "chrome.scripting.executeScript({target: {tabId}, files: ['scripts/hook.js'], world: inPage ? 'MAIN' : 'ISOLATED'})\n"

    expect(worldsOf(source)).toEqual(['ISOLATED', 'MAIN'])
  })

  it('reads a world held in a constant', () => {
    const source =
      "const WORLD = 'MAIN'\n" +
      "chrome.scripting.registerContentScripts([{id: 'a', js: ['scripts/hook.js'], world: WORLD}])\n"

    expect(worldsOf(source)).toEqual(['MAIN'])
  })

  it('keeps a typed world literal known', () => {
    const source =
      "chrome.scripting.registerContentScripts([{id: 'a', js: ['scripts/hook.js'], world: 'ISOLATED' as const}])\n"

    expect(worldsOf(source)).toEqual(['ISOLATED'])
  })
})

describe('a world the source cannot give', () => {
  const unknown = [
    [
      'a call',
      "chrome.scripting.registerContentScripts([{id: 'a', js: ['scripts/hook.js'], world: pickWorld()}])"
    ],
    [
      'a parameter',
      "function register(world) { chrome.scripting.registerContentScripts([{id: 'a', js: ['scripts/hook.js'], world}]) }"
    ],
    [
      'a let',
      "let world = 'MAIN'\nworld = other\nchrome.scripting.registerContentScripts([{id: 'a', js: ['scripts/hook.js'], world: world}])"
    ],
    [
      'a spread of a value that is no constant',
      "function register(options) { chrome.scripting.registerContentScripts([{...options, js: ['scripts/hook.js']}]) }"
    ],
    [
      'a spread after the world',
      "function register(options) { chrome.scripting.registerContentScripts([{js: ['scripts/hook.js'], world: 'MAIN', ...options}]) }"
    ],
    [
      'a map over a list that is no constant',
      "function register(worlds) { chrome.scripting.registerContentScripts(worlds.map((world) => ({id: world, js: ['scripts/hook.js'], world}))) }"
    ],
    [
      'a map whose callback does more than return an object',
      "chrome.scripting.registerContentScripts(['MAIN'].map((world) => { log(world); return {id: world, js: ['scripts/hook.js'], world} }))"
    ],
    [
      'a choice with an arm that is no literal',
      "chrome.scripting.executeScript({target, files: ['scripts/hook.js'], world: inPage ? 'MAIN' : fallback()})"
    ]
  ] as const

  for (const [name, source] of unknown) {
    it(`answers unknown for ${name}, and never the MAIN world alone`, () => {
      const worlds = worldsOf(source)

      expect(worlds).toContain('UNKNOWN')
      expect(extractMainWorldRegisteredFileLiterals(source)).toEqual(
        worlds.includes('MAIN') ? ['scripts/hook.js'] : []
      )
    })
  }

  it('names no file a mapped path is built from', () => {
    const source =
      "chrome.scripting.registerContentScripts(['a', 'b'].map((name) => ({id: name, js: ['scripts/' + name + '.js'], world: 'MAIN'})))\n"

    expect(extractRegisteredFileSightings(source)).toEqual([])
  })

  it('leaves a list no declaration of the file gives alone', () => {
    const source =
      "import {scripts} from './scripts'\n" +
      'chrome.scripting.registerContentScripts(scripts)\n' +
      'chrome.scripting.registerContentScripts(buildScripts())\n'

    expect(extractRegisteredFileSightings(source)).toEqual([])
  })

  it('does not throw on text it cannot read', () => {
    const broken = [
      'chrome.scripting.registerContentScripts(worlds.map(',
      'chrome.scripting.registerContentScripts([{...}])',
      'chrome.scripting.registerContentScripts(x.map(() => ({})))',
      "chrome.scripting.executeScript({files: ['scripts/hook.js'], world: })",
      'chrome.scripting.registerContentScripts(a.map(b).map((c) => ({world: c})))'
    ]

    for (const source of broken) {
      expect(() => extractRegisteredFileSightings(source)).not.toThrow()
    }
  })
})

describe('where a call is', () => {
  it('gives the same offset and worlds for CRLF and LF text', () => {
    const lf =
      '// a comment\n' +
      "const worlds = ['ISOLATED', 'MAIN']\n" +
      'chrome.scripting.registerContentScripts(\n' +
      "  worlds.map((world) => ({id: world, js: ['scripts/hook.js'], world}))\n" +
      ')\n'
    const crlf = lf.replace(/\n/g, '\r\n')
    const lineOf = (source: string) =>
      source
        .slice(0, extractRegisteredFileSightings(source)[0].index)
        .split('\n').length

    expect(worldsOf(crlf)).toEqual(['ISOLATED', 'MAIN'])
    expect(lineOf(lf)).toBe(3)
    expect(lineOf(crlf)).toBe(3)
  })

  it('reads no call out of a comment', () => {
    const source =
      "// chrome.scripting.registerContentScripts([{js: ['scripts/hook.js'], world: 'MAIN'}])\n"

    expect(extractRegisteredFileSightings(source)).toEqual([])
  })
})
