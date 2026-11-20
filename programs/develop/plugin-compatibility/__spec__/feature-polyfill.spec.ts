import * as fs from 'node:fs'
import * as path from 'node:path'
import {type Compiler, rspack} from '@rspack/core'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import {takeCodedWarnings} from '../../lib/coded-warnings'
import {diagnosticCode} from '../../lib/diagnostic-code'
import * as messages from '../compatibility-lib/messages'

// The plugin resolves through its own createRequire instance, so the only
// way to make that lookup fail is to hand it one that does.
const resolution = vi.hoisted(() => ({failWith: undefined as unknown}))

vi.mock('node:module', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:module')>()

  const createRequire: typeof actual.createRequire = (from) => {
    const real = actual.createRequire(from)

    const resolve = (...args: Parameters<typeof real.resolve>) => {
      if (resolution.failWith) throw resolution.failWith

      return real.resolve(...args)
    }

    return Object.assign((id: string) => real(id), real, {
      resolve: Object.assign(resolve, real.resolve)
    }) as typeof real
  }

  return {...actual, createRequire, default: {...actual, createRequire}}
})

import {polyfillAlias} from '..'
import {PolyfillPlugin, resolvePolyfillPath} from '../feature-polyfill'

const makeTempFolder = trackTempFolders()
const POLYFILL_FILE = path.join(
  'webextension-polyfill',
  'dist',
  'browser-polyfill.js'
)

function compilerAt(context: string, alias?: Record<string, string>): Compiler {
  return rspack({context, entry: {}, resolve: alias ? {alias} : undefined})
}

function aliasOf(compiler: Compiler): Record<string, unknown> {
  return (compiler.options.resolve.alias || {}) as Record<string, unknown>
}

function notFound(): Error {
  return Object.assign(
    new Error("Cannot find module 'webextension-polyfill'"),
    {
      code: 'MODULE_NOT_FOUND'
    }
  )
}

describe('PolyfillPlugin', () => {
  afterEach(() => {
    resolution.failWith = undefined
    vi.restoreAllMocks()
    takeCodedWarnings()
  })

  it("resolves the project's own copy and leaves the aliases to the config", () => {
    const project = makeTempFolder('extjs-polyfill-own-')
    const own = path.join(project, 'node_modules', POLYFILL_FILE)
    fs.mkdirSync(path.dirname(own), {recursive: true})
    fs.writeFileSync(own, 'module.exports = {}')

    const compiler = compilerAt(project, {keepMe: '/x/y/z'})
    new PolyfillPlugin({browser: 'chrome'}).apply(compiler)

    expect(resolvePolyfillPath(project)).toBe(fs.realpathSync(own))
    expect(
      polyfillAlias({polyfill: true, browser: 'chrome', context: project})
    ).toEqual({'webextension-polyfill$': fs.realpathSync(own)})

    expect(aliasOf(compiler)).toEqual({keepMe: '/x/y/z'})
  })

  it('falls back to the copy installed beside the plugin', () => {
    const project = makeTempFolder('extjs-polyfill-none-')
    const resolved = String(resolvePolyfillPath(project))

    expect(resolved.endsWith(POLYFILL_FILE)).toBe(true)
    expect(resolved.startsWith(project)).toBe(false)
    expect(fs.existsSync(resolved)).toBe(true)
  })

  it('warns among the build warnings, once, when the package is not installed', async () => {
    resolution.failWith = notFound()

    const project = makeTempFolder('extjs-polyfill-missing-')
    fs.writeFileSync(path.join(project, 'entry.js'), 'export default 1\n')

    const compiler = rspack({
      context: project,
      mode: 'production',
      entry: {entry: './entry.js'},
      output: {path: path.join(project, 'dist')}
    })
    const printed = vi.spyOn(console, 'warn').mockImplementation(() => {})
    new PolyfillPlugin().apply(compiler)

    const compile = () =>
      new Promise<Array<Error & {name: string}>>((resolve, reject) => {
        compiler.run((error, stats) => {
          if (error || !stats) return reject(error)

          resolve([...stats.compilation.warnings] as never)
        })
      })

    const first = await compile()
    const second = await compile()
    await new Promise((resolve) => compiler.close(resolve))

    expect(aliasOf(compiler)).toEqual({})
    expect(printed).not.toHaveBeenCalled()
    expect(first.map((warning) => warning.name)).toEqual([
      'PolyfillNotFoundWarning'
    ])

    expect(first[0].message).toContain(
      messages.webextensionPolyfillNotFound().split('\n')[0]
    )

    expect(diagnosticCode(first[0])).toBe('W_POLYFILL_NOT_FOUND')
    expect(second).toEqual([])
    expect(takeCodedWarnings()).toEqual([])
  })

  it('throws any other resolution failure instead of calling it not installed', () => {
    const denied = Object.assign(new Error('EACCES: permission denied'), {
      code: 'EACCES'
    })
    resolution.failWith = denied

    const compiler = compilerAt(makeTempFolder('extjs-polyfill-denied-'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(() => new PolyfillPlugin().apply(compiler)).toThrow(denied)
    expect(warn).not.toHaveBeenCalled()
    expect(takeCodedWarnings()).toEqual([])
  })

  it('throws a failure to wire the provider instead of calling it not installed', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const notACompiler = {options: {context: process.cwd()}} as Compiler

    expect(() => new PolyfillPlugin().apply(notACompiler)).toThrow(TypeError)
    expect(warn).not.toHaveBeenCalled()
    expect(takeCodedWarnings()).toEqual([])
  })
})
