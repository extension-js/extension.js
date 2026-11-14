import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {sources} from '@rspack/core'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {DEV_BOOT_REGISTERS_GLOBAL} from '../../dev-server/control-bridge/producer-runtime'
import {
  backgroundNamesRegistration,
  InjectBridgeProducer,
  readBootRegistrations
} from '../steps/inject-bridge-producer'

const REGISTERS =
  'chrome.scripting.registerContentScripts([{id: "a", js: ["a.js"], matches: ["<all_urls>"]}])'
const INJECTS =
  'chrome.scripting.executeScript({target: {tabId: 1}, files: ["a.js"]})'

let dir: string
const saved: Record<string, string | undefined> = {}

function source(name: string, text: string): string {
  const file = path.join(dir, name)

  fs.mkdirSync(path.dirname(file), {recursive: true})
  fs.writeFileSync(file, text)

  return file
}

// A module graph that names the script each module was emitted into.
function graph(modules: Array<{resource: string; file: string}>) {
  const byResource = new Map(modules.map((m) => [m.resource, m.file]))

  return {
    modules: modules.map((m) => ({resource: m.resource})),
    chunkGraph: {
      getModuleChunksIterable: (module: {resource?: string}) => [
        {files: [byResource.get(String(module.resource)) || '']}
      ]
    }
  }
}

type Built = Array<{resource: string; file: string}>

// Each entry is one compile of the same session, in order.
function build(
  first: {modules: Built; errors?: string[]},
  ...later: Array<{modules: Built}>
) {
  const taps: Array<() => void> = []
  const assets: Record<string, {name: string; source: sources.Source}> = {}
  let compilation: any
  const compiler: any = {
    hooks: {
      thisCompilation: {
        tap: (_name: string, cb: (c: unknown) => void) => {
          compilation = {
            ...graph(first.modules),
            errors: first.errors || [],
            getAssets: () => Object.values(assets),
            getAsset: (name: string) => assets[name],
            emitAsset: (name: string, src: sources.Source) => {
              assets[name] = {name, source: src}
            },
            updateAsset: (name: string, src: sources.Source) => {
              assets[name] = {name, source: src}
            },
            hooks: {
              processAssets: {
                tap: (_o: unknown, fn: () => void) => taps.push(fn)
              }
            }
          }

          cb(compilation)
        }
      }
    }
  }

  new InjectBridgeProducer().apply(compiler)

  const compile = () => {
    assets['background/service_worker.js'] = {
      name: 'background/service_worker.js',
      source: new sources.RawSource('/* user sw */')
    }

    for (const tap of taps) tap()
  }

  compile()

  for (const next of later) {
    Object.assign(compilation, graph(next.modules), {errors: []})
    compile()
  }

  return {
    compilation,
    background: String(assets['background/service_worker.js'].source.source())
  }
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-boot-registrations-'))

  for (const key of ['EXTENSION_CONTROL_PORT', 'EXTENSION_INSTANCE_ID']) {
    saved[key] = process.env[key]
  }

  process.env.EXTENSION_CONTROL_PORT = '8123'
  process.env.EXTENSION_INSTANCE_ID = 'abc123'
})

afterEach(() => {
  fs.rmSync(dir, {recursive: true, force: true})

  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('whether a background registers a content script', () => {
  it('reads a registration in a file the background was built from', () => {
    const file = source('background.ts', REGISTERS)

    expect(
      backgroundNamesRegistration(
        graph([{resource: file, file: 'background/service_worker.js'}])
      )
    ).toBe(true)
  })

  it('reads one in a file the Firefox background was built from', () => {
    const file = source('lib/register.js', REGISTERS)

    expect(
      backgroundNamesRegistration(
        graph([{resource: `${file}?v=1`, file: 'background/scripts.js'}])
      )
    ).toBe(true)
  })

  // An injection runs on a tab that is already open, so no page waits on it.
  it('names none for a background that only injects', () => {
    const file = source('background.ts', INJECTS)

    expect(
      backgroundNamesRegistration(
        graph([{resource: file, file: 'background/service_worker.js'}])
      )
    ).toBe(false)
  })

  // A page registers on a click, long after the first page of the session.
  it('names none for a registration another context makes', () => {
    const page = source('popup.ts', REGISTERS)
    const background = source('background.ts', 'console.log(1)')

    expect(
      backgroundNamesRegistration(
        graph([
          {resource: page, file: 'action/index.js'},
          {resource: background, file: 'background/service_worker.js'}
        ])
      )
    ).toBe(false)
  })

  it('names none when the module graph cannot be read', () => {
    expect(backgroundNamesRegistration({})).toBe(false)
    expect(
      backgroundNamesRegistration({
        modules: [{resource: path.join(dir, 'gone.ts')}],
        chunkGraph: {
          getModuleChunksIterable: () => {
            throw new Error('no graph')
          }
        }
      })
    ).toBe(false)
  })
})

describe('InjectBridgeProducer, the boot registration mark', () => {
  it('marks a background that registers, and says so for its compilation', () => {
    const file = source('background.ts', REGISTERS)
    const out = build({
      modules: [{resource: file, file: 'background/service_worker.js'}]
    })

    expect(out.background).toContain(
      `globalThis.${DEV_BOOT_REGISTERS_GLOBAL}=true;`
    )

    expect(out.background.indexOf(DEV_BOOT_REGISTERS_GLOBAL)).toBeLessThan(
      out.background.indexOf('__extjsBridgeProducerInstalled')
    )

    expect(readBootRegistrations(out.compilation)).toBe(true)
  })

  it('leaves a background that registers nothing unmarked', () => {
    const file = source('background.ts', INJECTS)
    const out = build({
      modules: [{resource: file, file: 'background/service_worker.js'}]
    })

    expect(out.background).not.toContain(
      `globalThis.${DEV_BOOT_REGISTERS_GLOBAL}=true;`
    )

    expect(readBootRegistrations(out.compilation)).toBe(false)
    expect(readBootRegistrations(undefined)).toBe(false)
  })

  // The answer is for the launch, so later compiles do not read every
  // source of the background again.
  it('keeps the answer of the first compile for the session', () => {
    const first = source('background.ts', INJECTS)
    const second = source('next.ts', REGISTERS)
    const out = build(
      {modules: [{resource: first, file: 'background/service_worker.js'}]},
      {modules: [{resource: second, file: 'background/service_worker.js'}]}
    )

    expect(readBootRegistrations(out.compilation)).toBe(false)
  })

  // No browser is launched on a compile that failed, so the launch reads
  // the first compile that built.
  it('reads again after a first compile that failed', () => {
    const first = source('background.ts', INJECTS)
    const second = source('next.ts', REGISTERS)
    const out = build(
      {
        modules: [{resource: first, file: 'background/service_worker.js'}],
        errors: ['Module not found']
      },
      {modules: [{resource: second, file: 'background/service_worker.js'}]}
    )

    expect(readBootRegistrations(out.compilation)).toBe(true)
  })
})
