import * as path from 'node:path'
import {afterAll, afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {diagnosticCode} from '../../lib/diagnostic-code'
import {EnvPlugin} from '../env'
import {keepEnvWrites} from '../env-write-loader'
import {
  compile,
  makeTempRoot,
  removeTempRoots,
  runScript,
  writeFiles
} from './helpers/real-compile'

type Mode = 'development' | 'production'

const stripAnsi = (value: string) => value.replace(/\x1b\[[0-9;]*m/g, '')

async function build(mode: Mode, files: Record<string, string>) {
  const root = makeTempRoot('env-write')
  const outputPath = path.join(root, 'out')
  writeFiles(root, {'.env': 'EXTENSION_PUBLIC_X=v\n', ...files})

  const stats = await compile({
    context: root,
    outputPath,
    mode,
    entry: {entry: './entry.js'},
    plugins: [new EnvPlugin({browser: 'chrome'})]
  })

  return {
    errors: Array.from(stats.compilation.errors, (error) =>
      stripAnsi(error.message)
    ),
    warnings: Array.from(stats.compilation.warnings, (warning) => ({
      code: diagnosticCode(warning),
      message: stripAnsi(warning.message)
    })),
    logs: () => runScript(path.join(outputPath, 'entry.js'))
  }
}

beforeEach(() => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('EXTENSION_')) vi.stubEnv(key, undefined)
  }
})

afterEach(() => {
  vi.unstubAllEnvs()
})

afterAll(() => {
  removeTempRoots()
})

describe.each([
  'development',
  'production'
] as const)('a write to a defined env name in a %s build', (mode) => {
  it('builds, and the write reaches the env object while dotted reads keep the build value', async () => {
    const result = await build(mode, {
      'entry.js': [
        "const key = 'EXTENSION_PUBLIC_X'",
        "process.env.EXTENSION_PUBLIC_X = 'w'",
        'console.log(process.env.EXTENSION_PUBLIC_X, process.env[key])',
        ''
      ].join('\n')
    })

    expect(result.errors).toEqual([])
    expect(result.logs()).toEqual(['v w'])
  })

  it('builds every other way of writing one', async () => {
    const result = await build(mode, {
      'entry.js': [
        "const key = 'EXTENSION_PUBLIC_X'",
        "process.env['EXTENSION_PUBLIC_X'] = 'a'",
        "process.env.EXTENSION_PUBLIC_X += 'b'",
        'process.env.EXTENSION_PUBLIC_MODE++',
        ";({x: process.env.EXTENSION_PUBLIC_X} = {x: 'c'})",
        "import.meta.env.EXTENSION_PUBLIC_X = 'd'",
        'delete process.env.EXTENSION_PUBLIC_BROWSER',
        'console.log(process.env[key], typeof process.env.EXTENSION_PUBLIC_BROWSER)',
        ''
      ].join('\n')
    })

    expect(result.errors).toEqual([])
    expect(result.logs()).toEqual(['c string'])
  })

  it('names each written line once, and only for project code', async () => {
    const result = await build(mode, {
      'entry.js': [
        "import './node_modules/dep/index.js'",
        "process.env.EXTENSION_PUBLIC_X = 'w'",
        "process.env.EXTENSION_PUBLIC_OTHER = 'not defined, so not replaced'",
        ''
      ].join('\n'),
      'node_modules/dep/index.js': "process.env.EXTENSION_PUBLIC_X = 'dep'\n"
    })

    expect(result.errors).toEqual([])
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0].code).toBe('W_ENV_DEFINE_WRITTEN')
    expect(result.warnings[0].message).toContain(
      'Line 2 writes process.env.EXTENSION_PUBLIC_X, which the build replaces with its value.'
    )

    expect(result.warnings[0].message).not.toContain('Line 3')
  })
})

describe('keepEnvWrites', () => {
  it('returns a module that never writes to an env object as it came', () => {
    const source = 'console.log(process.env.EXTENSION_PUBLIC_X === "v")\n'

    expect(keepEnvWrites(source)).toEqual({code: source, writes: []})
  })

  it('leaves the same text inside a string or a comment alone', () => {
    const source = [
      "const doc = 'process.env.EXTENSION_PUBLIC_X = 1'",
      '// process.env.EXTENSION_PUBLIC_X = 2',
      ''
    ].join('\n')

    expect(keepEnvWrites(source)).toEqual({code: source, writes: []})
  })

  it('wraps only the env object of a write, so a read beside it is still replaced', () => {
    const {code, writes} = keepEnvWrites(
      'process.env.A = process.env.A + import.meta.env.B\n'
    )

    expect(code).toBe(
      ';(0,process.env).A = process.env.A + import.meta.env.B\n'
    )

    expect(writes).toEqual([{name: 'A', read: 'process.env.A', line: 1}])
  })

  it('keeps a written line from calling the line before it', () => {
    const {code} = keepEnvWrites(
      "const a = 1\nprocess.env.A = 'w'\nif (a) process.env.B = 'x'\n"
    )

    expect(code).toBe(
      "const a = 1\n;(0,process.env).A = 'w'\nif (a) (0,process.env).B = 'x'\n"
    )
  })

  it('leaves a module it cannot parse as it came', () => {
    const source = 'process.env.A = <div />\n'

    expect(keepEnvWrites(source)).toEqual({code: source, writes: []})
  })
})
