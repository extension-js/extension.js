import * as fs from 'node:fs'
import * as path from 'node:path'
import {type Compiler, rspack} from '@rspack/core'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import {takeCodedWarnings} from '../../lib/coded-warnings'
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

import {PolyfillPlugin} from '../feature-polyfill'

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

  it("aliases the package to the project's own copy and keeps other aliases", () => {
    const project = makeTempFolder('extjs-polyfill-own-')
    const own = path.join(project, 'node_modules', POLYFILL_FILE)
    fs.mkdirSync(path.dirname(own), {recursive: true})
    fs.writeFileSync(own, 'module.exports = {}')

    const compiler = compilerAt(project, {keepMe: '/x/y/z'})
    new PolyfillPlugin({browser: 'chrome'}).apply(compiler)

    expect(aliasOf(compiler)).toEqual({
      keepMe: '/x/y/z',
      'webextension-polyfill$': fs.realpathSync(own)
    })
  })

  it('falls back to the copy installed beside the plugin', () => {
    const project = makeTempFolder('extjs-polyfill-none-')
    const compiler = compilerAt(project)
    new PolyfillPlugin().apply(compiler)

    const aliased = String(aliasOf(compiler)['webextension-polyfill$'])

    expect(aliased.endsWith(POLYFILL_FILE)).toBe(true)
    expect(aliased.startsWith(project)).toBe(false)
    expect(fs.existsSync(aliased)).toBe(true)
  })

  it('warns and leaves the compiler alone when the package is not installed', () => {
    resolution.failWith = notFound()

    const project = makeTempFolder('extjs-polyfill-missing-')
    const compiler = compilerAt(project)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    new PolyfillPlugin().apply(compiler)

    expect(aliasOf(compiler)).toEqual({})
    expect(warn.mock.calls).toEqual([[messages.webextensionPolyfillNotFound()]])
    expect(takeCodedWarnings()).toEqual([
      'W_POLYFILL_NOT_FOUND: webextension-polyfill is not installed, so the browser API polyfill is off for this build.'
    ])
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
