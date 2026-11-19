import {spawnSync} from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {pathToFileURL} from 'node:url'
import {beforeAll, describe, expect, it} from 'vitest'
import {RUST_MIN_STACK_BYTES} from '../lib/rust-min-stack'
import {staticGraphOf} from './helpers/dist-import-graph'
import {trackTempFolders} from './helpers/temp-folders'

const DEVELOP_ROOT = path.resolve(__dirname, '..')
const DIST_DIR = path.join(DEVELOP_ROOT, 'dist')
const MODULE_ENTRY = path.join(DIST_DIR, 'module.mjs')
const tempFolder = trackTempFolders()

// Every file a host can import by name, read from the exports map.
function publicNodeEntries(): string[] {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(DEVELOP_ROOT, 'package.json'), 'utf8')
  ) as {exports: Record<string, unknown>}

  const files = Object.values(manifest.exports)
    .map((target) =>
      target && typeof target === 'object'
        ? (target as {import?: string}).import
        : undefined
    )
    .filter((file): file is string => typeof file === 'string')

  return [...new Set(files)].map((file) => path.resolve(DEVELOP_ROOT, file))
}

const DYNAMIC_SPECIFIER = /\bimport\(\s*["'](\.[^"']+)["']\s*\)/g

// True when the entry can load rspack at any point, a lazy import included.
function canLoadRspack(entryFile: string): boolean {
  const seen = new Set<string>()
  const queue = [entryFile]

  while (queue.length > 0) {
    const graph = staticGraphOf(queue.shift() as string)

    if (graph.packages.has('@rspack/core')) return true

    for (const file of graph.files) {
      if (seen.has(file)) continue

      seen.add(file)

      for (const match of fs
        .readFileSync(file, 'utf8')
        .matchAll(DYNAMIC_SPECIFIER)) {
        queue.push(path.resolve(path.dirname(file), match[1]))
      }
    }
  }

  return false
}

// Records the variable at the moment the native binding is first asked for.
const BINDING_PROBE = `const Module = require('node:module')
const load = Module._load
let seen = false

Module._load = function (request, ...rest) {
  if (!seen && /@rspack[\\\\/]binding/.test(String(request))) {
    seen = true
    globalThis.__stackAtBindingLoad = process.env.RUST_MIN_STACK ?? 'unset'
  }

  return load.call(this, request, ...rest)
}
`

// The rspack binding sizes its threads while it loads. Setting the variable
// after that changes nothing, so the built entry is read, not the source.
describe('the stack guard in the built extension-develop entry', () => {
  beforeAll(() => {
    if (!fs.existsSync(MODULE_ENTRY)) {
      throw new Error(
        `${MODULE_ENTRY} does not exist. Run \`pnpm --filter extension-develop compile\` ` +
          'before vitest so this gate has a build to read.'
      )
    }
  })

  it('is still in the build after the bundler dropped unused code', () => {
    // Two entries call the guard, so its body sits in a file both import.
    const built = staticGraphOf(MODULE_ENTRY)
      .files.map((file) => fs.readFileSync(file, 'utf8'))
      .join('\n')

    expect(
      built,
      'module.mjs no longer sets RUST_MIN_STACK. The package is marked ' +
        'side-effect free, so a guard that is only imported is removed.'
    ).toMatch(/env\.RUST_MIN_STACK\s*=/)

    expect(built).toContain(String(RUST_MIN_STACK_BYTES))
  })

  it('runs before any file that loads @rspack/core', () => {
    const built = fs.readFileSync(MODULE_ENTRY, 'utf8')
    const graph = staticGraphOf(MODULE_ENTRY)

    expect(
      graph.packages.get('@rspack/core'),
      'module.mjs reaches @rspack/core through static imports, which run ' +
        'before the body of module.mjs, so the guard would run too late.'
    ).toBeUndefined()

    const guardCall = built.search(/^ensureRustMinStack\(\);/m)
    const firstLoad = built.indexOf('import(')

    expect(guardCall).toBeGreaterThan(-1)
    expect(firstLoad).toBeGreaterThan(guardCall)
  })

  it('sets the variable in a process that imports the built entry', () => {
    const script =
      `await import(${JSON.stringify(pathToFileURL(MODULE_ENTRY).href)});` +
      'process.stdout.write(String(process.env.RUST_MIN_STACK))'

    const run = (preset?: string) => {
      const env: NodeJS.ProcessEnv = {...process.env}
      delete env.RUST_MIN_STACK

      if (preset) env.RUST_MIN_STACK = preset

      return spawnSync(
        process.execPath,
        ['--input-type=module', '-e', script],
        {encoding: 'utf8', env}
      )
    }

    const unset = run()
    expect(unset.status, unset.stderr).toBe(0)
    expect(unset.stdout).toBe(String(RUST_MIN_STACK_BYTES))

    const preset = run('8388608')
    expect(preset.status, preset.stderr).toBe(0)
    expect(preset.stdout).toBe('8388608')
  }, 60_000)

  it('runs first in every public entry that can load rspack', () => {
    const entries = publicNodeEntries()
    const reaching = entries.filter(canLoadRspack)

    expect(entries.map((file) => path.basename(file))).toContain('preview.mjs')
    expect(reaching.map((file) => path.basename(file))).toContain('module.mjs')

    for (const entry of reaching) {
      const name = path.basename(entry)
      const built = fs.readFileSync(entry, 'utf8')
      const guardCall = built.search(/^ensureRustMinStack\(\);/m)

      expect(
        staticGraphOf(entry).packages.get('@rspack/core'),
        `${name} reaches @rspack/core through static imports, which run ` +
          'before its body, so a host that imports it first gets no guard.'
      ).toBeUndefined()

      expect(guardCall, `${name} never calls the guard`).toBeGreaterThan(-1)
      expect(built.indexOf('import(')).toBeGreaterThan(guardCall)
    }
  })

  it('has run by the time the binding loads, whichever entry comes first', () => {
    const probe = path.join(tempFolder('extjs-stack-guard-'), 'probe.cjs')

    fs.writeFileSync(probe, BINDING_PROBE)

    const orders = [
      ['preview.mjs', 'module.mjs'],
      ['module.mjs', 'preview.mjs'],
      ['bridge.mjs', 'manifest.mjs', 'preview.mjs', 'module.mjs']
    ]

    for (const order of orders) {
      const imports = order
        .map((name) => pathToFileURL(path.join(DIST_DIR, name)).href)
        .map((href) => `await import(${JSON.stringify(href)});`)
        .join('')

      const env: NodeJS.ProcessEnv = {...process.env}
      delete env.RUST_MIN_STACK

      const run = spawnSync(
        process.execPath,
        [
          '--require',
          probe,
          '--input-type=module',
          '-e',
          `${imports}process.stdout.write(String(globalThis.__stackAtBindingLoad))`
        ],
        {encoding: 'utf8', env}
      )

      expect(run.status, run.stderr).toBe(0)
      expect(run.stdout, `import order: ${order.join(', ')}`).toBe(
        String(RUST_MIN_STACK_BYTES)
      )
    }
  }, 120_000)
})
