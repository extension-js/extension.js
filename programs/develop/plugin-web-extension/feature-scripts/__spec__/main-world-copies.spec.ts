import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {buildMainWorldBridgePairingSource} from '../scripts-lib/main-world-bridge-pairing'
import {MAIN_WORLD_COPY_ROUTING_MARK} from '../scripts-lib/main-world-copy-routing'
import {
  findRuntimeMainWorldEntries,
  findUnknownWorldRegistrations,
  withMainWorldCopyEntries
} from '../scripts-lib/runtime-main-world-scripts'
import {RouteMainWorldCopies} from '../steps/route-main-world-copies'
import {WarnUnknownRegistrationWorld} from '../steps/warn-unknown-registration-world'

const roots: string[] = []

afterEach(() => {
  while (roots.length > 0) {
    fs.rmSync(roots.pop()!, {recursive: true, force: true})
  }
})

const BOTH =
  'chrome.scripting.registerContentScripts([\n' +
  "  {id: 'iso', js: ['scripts/hook.js'], matches: ['<all_urls>'], world: 'ISOLATED'},\n" +
  "  {id: 'main', js: ['scripts/hook.js'], matches: ['<all_urls>'], world: 'MAIN'}\n" +
  '])\n'
const MAIN_ONLY =
  "chrome.scripting.registerContentScripts([{id: 'main', js: ['scripts/hook.js'], matches: ['<all_urls>'], world: 'MAIN'}])\n"
const COMPUTED =
  "const worlds = ['ISOLATED', 'MAIN']\n" +
  "chrome.scripting.registerContentScripts(worlds.map(world => ({id: 'h-' + world, js: ['scripts/hook.js'], matches: ['<all_urls>'], world})))\n"
const UNKNOWN =
  '// the world is picked as the call runs\n' +
  'export function register(world) {\n' +
  '  chrome.scripting.registerContentScripts([\n' +
  "    {id: 'a', js: ['scripts/hook.js', 'scripts/other.js'], matches: ['<all_urls>'], world}\n" +
  '  ])\n' +
  '}\n'

function project(background: string, extra: Record<string, string> = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-both-worlds-'))
  roots.push(root)

  const at = (...parts: string[]) => path.join(root, ...parts)
  const files: Record<string, string> = {
    'manifest.json': '{}',
    'background.js': background,
    ...extra
  }

  fs.mkdirSync(at('scripts'), {recursive: true})
  fs.writeFileSync(at('scripts', 'hook.js'), 'window.__HOOK__ = 1\n')
  fs.writeFileSync(at('scripts', 'other.js'), 'window.__OTHER__ = 1\n')

  for (const [name, text] of Object.entries(files)) {
    fs.writeFileSync(at(...name.split('/')), text)
  }

  const options = {
    includeList: {
      'background/service_worker': at('background.js'),
      'scripts/hook': at('scripts', 'hook.js'),
      'scripts/other': at('scripts', 'other.js')
    },
    manifestDir: root,
    projectPath: root
  }

  return {root, at, options}
}

describe('a scripts/ file registered in both worlds', () => {
  it('is answered as a MAIN world copy under a name of its own', () => {
    const {at, options} = project(BOTH)

    expect(findRuntimeMainWorldEntries(options)).toEqual([
      {
        entryName: 'scripts/hook.extjs-main-world',
        files: [at('scripts', 'hook.js')],
        registeredBy: at('background.js'),
        copyOf: 'scripts/hook'
      }
    ])
  })

  it('gets an entry for the copy, beside the one the file keeps', () => {
    const {at, options} = project(BOTH)
    const list = withMainWorldCopyEntries(options)

    expect(list['scripts/hook']).toBe(at('scripts', 'hook.js'))
    expect(list['scripts/hook.extjs-main-world']).toBe(at('scripts', 'hook.js'))
    expect(Object.keys(list)).toHaveLength(4)
    // The list with the copy in it answers the same entries again.
    expect(
      findRuntimeMainWorldEntries({...options, includeList: list}).map(
        (entry) => entry.entryName
      )
    ).toEqual(['scripts/hook.extjs-main-world'])
  })

  it('is found through a registration that maps a list of worlds', () => {
    const {options} = project(COMPUTED)

    expect(findRuntimeMainWorldEntries(options)).toMatchObject([
      {entryName: 'scripts/hook.extjs-main-world', copyOf: 'scripts/hook'}
    ])

    expect(findUnknownWorldRegistrations(options)).toEqual([])
  })

  it('is found when the isolated world injects it with no world named', () => {
    const {options} = project(
      `${MAIN_ONLY}chrome.scripting.executeScript({target: {tabId: 1}, files: ['scripts/hook.js']})\n`
    )

    expect(findRuntimeMainWorldEntries(options)).toMatchObject([
      {copyOf: 'scripts/hook'}
    ])
  })

  it('leaves a file of the author under the copy name alone', () => {
    const {at, options} = project(BOTH)
    const taken = at('scripts', 'hook.extjs-main-world.js')
    fs.writeFileSync(taken, 'window.__MINE__ = 1\n')

    const includeList = {
      ...options.includeList,
      'scripts/hook.extjs-main-world': taken
    }

    expect(findRuntimeMainWorldEntries({...options, includeList})).toEqual([
      {
        entryName: 'scripts/hook',
        files: [at('scripts', 'hook.js')],
        registeredBy: at('background.js')
      }
    ])

    expect(withMainWorldCopyEntries({...options, includeList})).toBe(
      includeList
    )
  })
})

describe('a scripts/ file registered in one world', () => {
  it('keeps its name and its list when only the MAIN world runs it', () => {
    const {at, options} = project(MAIN_ONLY)

    expect(findRuntimeMainWorldEntries(options)).toEqual([
      {
        entryName: 'scripts/hook',
        files: [at('scripts', 'hook.js')],
        registeredBy: at('background.js')
      }
    ])

    expect(withMainWorldCopyEntries(options)).toBe(options.includeList)
  })

  it('is no MAIN world entry when only the isolated world runs it', () => {
    const {options} = project(
      "chrome.scripting.registerContentScripts([{id: 'iso', js: ['scripts/hook.js'], matches: ['<all_urls>']}])\n"
    )

    expect(findRuntimeMainWorldEntries(options)).toEqual([])
    expect(withMainWorldCopyEntries(options)).toBe(options.includeList)
  })
})

describe('a call that leaves the world to the running code', () => {
  it('is named with its source and line, and builds no MAIN world file', () => {
    const {at, options} = project(UNKNOWN)

    expect(findRuntimeMainWorldEntries(options)).toEqual([])
    expect(findUnknownWorldRegistrations(options)).toEqual([
      {
        file: at('background.js'),
        line: 3,
        literal: 'scripts/hook.js',
        emitted: 'scripts/hook.js'
      },
      {
        file: at('background.js'),
        line: 3,
        literal: 'scripts/other.js',
        emitted: 'scripts/other.js'
      }
    ])
  })

  it('counts the line the same in a CRLF file', () => {
    const {options} = project(UNKNOWN.replace(/\n/g, '\r\n'))

    expect(
      findUnknownWorldRegistrations(options).map((call) => call.line)
    ).toEqual([3, 3])
  })

  it('names no file that is not a scripts/ entry', () => {
    const {options} = project(
      "export const run = (world) => chrome.scripting.executeScript({target: {tabId: 1}, files: ['vendor/lib.js'], world})\n"
    )

    expect(findUnknownWorldRegistrations(options)).toEqual([])
  })

  it('warns once for the call, whatever the number of files', () => {
    const {root, at, options} = project(UNKNOWN)
    let compile: ((compilation: {warnings: Error[]}) => void) | undefined

    new WarnUnknownRegistrationWorld({
      manifestPath: at('manifest.json'),
      includeList: options.includeList
    }).apply({
      options: {mode: 'production', context: root},
      hooks: {
        thisCompilation: {
          tap: (_name: string, callback: typeof compile) => {
            compile = callback
          }
        }
      }
    } as any)

    const compilation = {warnings: [] as Array<Error & {file?: string}>}
    compile?.(compilation)

    expect(compilation.warnings).toHaveLength(1)

    const [warning] = compilation.warnings

    expect(warning.name).toBe('UnknownRegistrationWorld')
    expect(warning.file).toBe('background.js')
    expect(warning.message).toContain('background.js:3')
    expect(warning.message).toContain('scripts/hook.js')
    expect(warning.message).toContain('scripts/other.js')
    expect(warning.message).toContain('isolated world script')
  })

  it('stays silent for a world the build can read', () => {
    for (const background of [BOTH, MAIN_ONLY, COMPUTED]) {
      const {options} = project(background)

      expect(findUnknownWorldRegistrations(options)).toEqual([])
    }
  })
})

// A compilation of the two files a routing or a pairing is prepended to.
function compilationOf(assets: Record<string, string>) {
  const taps: Array<{stage: number; run: () => void}> = []
  const compilation = {
    entrypoints: new Map(),
    getAssets: () =>
      Object.entries(assets).map(([name, text]) => ({
        name,
        source: {source: () => text},
        info: {}
      })),
    getAsset: (name: string) =>
      name in assets ? {name, source: {source: () => assets[name]}} : undefined,
    updateAsset: (name: string, source: {source: () => string | Buffer}) => {
      assets[name] = source.source().toString()
    },
    hooks: {
      processAssets: {
        tap: (options: {stage: number}, run: () => void) => {
          taps.push({stage: options.stage, run})
        }
      }
    }
  }

  return {
    compilation,
    run: () => {
      for (const tap of taps.sort((a, b) => a.stage - b.stage)) tap.run()
    }
  }
}

describe('the routing a build prepends', () => {
  function routed(background: string) {
    const {root, at, options} = project(background)
    const assets: Record<string, string> = {
      'background/service_worker.js': 'console.log("background")\n',
      'scripts/hook.js': 'console.log("hook")\n'
    }
    const {compilation, run} = compilationOf(assets)

    new RouteMainWorldCopies({
      manifestPath: at('manifest.json'),
      includeList: withMainWorldCopyEntries(options)
    }).apply({
      options: {mode: 'production', context: root},
      hooks: {
        thisCompilation: {
          tap: (_name: string, callback: (value: unknown) => void) =>
            callback(compilation)
        }
      }
    } as any)

    run()

    return assets
  }

  it('routes the background of a build with a file in both worlds', () => {
    const assets = routed(BOTH)
    const background = assets['background/service_worker.js']

    expect(background).toContain(MAIN_WORLD_COPY_ROUTING_MARK)
    expect(background).toContain(
      '{"scripts/hook.js":"scripts/hook.extjs-main-world.js"}'
    )

    expect(background.endsWith('console.log("background")\n')).toBe(true)
    expect(assets['scripts/hook.js']).toBe('console.log("hook")\n')
  })

  it('adds nothing to a build with one world for each file', () => {
    const assets = routed(MAIN_ONLY)

    expect(assets['background/service_worker.js']).toBe(
      'console.log("background")\n'
    )
  })

  it('sits inside the bridge pairing, which then runs first', () => {
    const background = routed(BOTH)['background/service_worker.js']
    const paired = `${buildMainWorldBridgePairingSource()}\n${background}`

    expect(paired.indexOf('extjs-main-world-bridge')).toBeLessThan(
      paired.indexOf(MAIN_WORLD_COPY_ROUTING_MARK)
    )
  })
})
