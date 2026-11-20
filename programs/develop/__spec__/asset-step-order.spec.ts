import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {type Compiler, rspack, type Stats} from '@rspack/core'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {getProjectStructure} from '../lib/project'
import webpackConfig from '../rspack-config'
import {writeProject} from './helpers/real-compiler'

// Steps that share a stage run in the order their plugins were listed, so a
// step that rewrites a script has to sit at a stage of its own, ahead of
// every step that reads the script.

interface StepRun {
  name: string
  stage: number
  reads: Set<string>
  writes: Set<string>
}

// Listed first, so every later tap on the asset hook is recorded as it runs.
class RecordAssetSteps {
  readonly runs: StepRun[] = []

  apply(compiler: Compiler) {
    compiler.hooks.thisCompilation.tap(
      {name: 'record-asset-steps', stage: -100000},
      (compilation) => {
        let current: StepRun | undefined

        const reading = <T extends {name: string}>(asset: T | undefined) =>
          asset &&
          new Proxy(asset, {
            get(target, key) {
              if (key === 'source') current?.reads.add(target.name)

              return Reflect.get(target, key)
            }
          })

        const getAsset = compilation.getAsset.bind(compilation)
        const getAssets = compilation.getAssets.bind(compilation)
        const updateAsset = compilation.updateAsset.bind(compilation)

        compilation.getAsset = ((name: string) =>
          reading(getAsset(name))) as typeof compilation.getAsset

        compilation.getAssets = (() =>
          getAssets().map(reading)) as typeof compilation.getAssets

        compilation.updateAsset = ((...args: unknown[]) => {
          current?.writes.add(String(args[0]))

          return (updateAsset as (...rest: unknown[]) => unknown)(...args)
        }) as typeof compilation.updateAsset

        const hook = compilation.hooks.processAssets as unknown as Record<
          'tap' | 'tapPromise',
          (options: unknown, fn: (...args: unknown[]) => unknown) => unknown
        >

        for (const kind of ['tap', 'tapPromise'] as const) {
          const register = hook[kind].bind(hook)

          hook[kind] = (options, fn) => {
            const named = options as string | {name: string; stage?: number}

            const run = (...args: unknown[]) => {
              const step: StepRun = {
                name: typeof named === 'string' ? named : named.name,
                stage: typeof named === 'string' ? 0 : named.stage || 0,
                reads: new Set(),
                writes: new Set()
              }
              const outer = current

              this.runs.push(step)
              current = step

              const done = () => {
                current = outer
              }

              try {
                const result = fn(...args)

                if (result instanceof Promise) return result.finally(done)

                done()

                return result
              } catch (error) {
                done()

                throw error
              }
            }

            return register(options, run)
          }
        }
      }
    )
  }
}

const roots: string[] = []
let runs: StepRun[] = []
let errors: string[] = []

const isScript = (name: string) => /\.[cm]?js$/.test(name)

beforeAll(async () => {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-step-order-'))
  )
  roots.push(root)

  writeProject(root, {
    'package.json': {private: true, name: 'step-order', version: '0.0.0'},
    'manifest.json': {
      manifest_version: 3,
      name: 'step-order',
      version: '1.0.0',
      background: {service_worker: 'background.js'},
      permissions: ['scripting'],
      content_scripts: [
        {matches: ['https://example.com/*'], js: ['content/index.js']},
        {
          matches: ['https://example.com/*'],
          js: ['content/main.js'],
          world: 'MAIN'
        }
      ]
    },
    'background.js':
      'chrome.scripting.executeScript({target: {tabId: 1}, files: ["scripts/injected.js"]})\n',
    'scripts/injected.js': 'const answer = 41 + 1\nanswer\n',
    'content/index.js':
      'import "./own.css"\nimport("./lazy.js").then((lazy) => console.log(lazy.a))\n',
    'content/lazy.js': 'export const a = 1\n',
    'content/own.css': '.own { color: red }\n',
    'content/main.js': 'window.fromMainWorld = chrome.runtime.id\n'
  })

  const config = webpackConfig(await getProjectStructure(root), {
    browser: 'safari',
    mode: 'production',
    metadataCommand: 'build',
    silent: true,
    output: {clean: false, path: path.join(root, 'dist', 'safari')}
  } as never)
  const recorder = new RecordAssetSteps()

  config.plugins = [
    recorder as never,
    ...(config.plugins || []).filter(
      (plugin) => plugin?.constructor.name !== 'plugin-browsers'
    )
  ]

  config.stats = false

  const compiler = rspack(config)
  const stats = await new Promise<Stats>((resolve, reject) => {
    compiler.run((error, result) => {
      compiler.close(() =>
        error || !result
          ? reject(error || new Error('no stats'))
          : resolve(result)
      )
    })
  })

  errors = (stats.toJson({all: false, errors: true}).errors || []).map(
    (error) => error.message
  )

  runs = recorder.runs
}, 60_000)

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

const indexOf = (name: string) => runs.findIndex((run) => run.name === name)
const stageOf = (name: string) => runs[indexOf(name)]?.stage

describe('the order of the steps that rewrite emitted scripts', () => {
  it('compiles the fixture and records the steps', () => {
    expect(errors).toEqual([])
    expect(indexOf('scripts:resolve-bundle-css-probe')).toBeGreaterThan(-1)
    expect(
      [...runs[indexOf('scripts:resolve-bundle-css-probe')].writes].filter(
        isScript
      )
    ).not.toEqual([])
  })

  it('fills the stylesheet names in a bundle before any step scans it', () => {
    const probe = stageOf('scripts:resolve-bundle-css-probe')

    expect(probe).toBeLessThan(Number(stageOf('TraceRuntimeLoadedFiles')))
    expect(probe).toBeLessThan(
      Number(
        stageOf(
          'plugin-web-extension:feature-web-resources:collect-entry-imports'
        )
      )
    )
  })

  it('has no step read a script another step of the same stage rewrites', () => {
    const ties: string[] = []

    for (const writer of runs) {
      for (const reader of runs) {
        if (writer === reader || writer.stage !== reader.stage) continue

        for (const name of writer.writes) {
          if (isScript(name) && reader.reads.has(name)) {
            ties.push(`${writer.name} and ${reader.name} on ${name}`)
          }
        }
      }
    }

    expect(ties).toEqual([])
  })

  it('checks script syntax after every rewrite but the byte order mark', () => {
    const check = indexOf('scripts:validate-emitted-script-syntax')
    const later = runs
      .slice(check + 1)
      .filter((run) => [...run.writes].some(isScript))
      .map((run) => run.name)

    expect(check).toBeGreaterThan(-1)
    expect(later).toEqual(['scripts:stamp-webkit-utf8-bom'])
  })
})
