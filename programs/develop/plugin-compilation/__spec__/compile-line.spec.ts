import * as path from 'node:path'
import type {Compiler} from '@rspack/core'
import {afterAll, beforeEach, describe, expect, it, vi} from 'vitest'
import {CompilationPlugin} from '../index'
import {
  createCompiler,
  makeTempRoot,
  removeTempRoots,
  runCompiler,
  writeFiles
} from './helpers/real-compile'

type Command = 'dev' | 'build'

const STAMP = String.raw`^⏵⏵⏵ \[\d{2}:\d{2}:\d{2}\] Real Name `

// Every console call of the run, in the order a terminal would show them.
let printed: Array<{channel: 'log' | 'warn' | 'error'; text: string}>

beforeEach(() => {
  vi.restoreAllMocks()
  printed = []

  for (const channel of ['log', 'warn', 'error'] as const) {
    vi.spyOn(console, channel).mockImplementation((...args: unknown[]) => {
      printed.push({channel, text: args.map(String).join(' ')})
    })
  }
})

afterAll(() => {
  vi.restoreAllMocks()
  removeTempRoots()
})

function scaffold() {
  const root = makeTempRoot('compile-line')
  writeFiles(root, {
    'manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'Real Name',
      version: '1.0.0'
    }),
    'background.js': 'console.log("ran")\n'
  })

  return root
}

// Pushed while the compilation runs, the way a plugin reports a finding.
function diagnostics(warnings: number, errors: number) {
  return (compiler: Compiler) => {
    compiler.hooks.thisCompilation.tap('spec:diagnostics', (compilation) => {
      for (let index = 1; index <= warnings; index++) {
        compilation.warnings.push(new Error(`spec warning ${index}`) as never)
      }

      for (let index = 1; index <= errors; index++) {
        compilation.errors.push(new Error(`spec error ${index}`) as never)
      }
    })
  }
}

async function run(
  command: Command,
  ...later: Array<(compiler: Compiler) => void>
) {
  const root = scaffold()

  await runCompiler(
    createCompiler({
      context: root,
      outputPath: path.join(root, 'dist', 'chrome'),
      entry: {background: './background.js'},
      plugins: [
        new CompilationPlugin({
          manifestPath: path.join(root, 'manifest.json'),
          browser: 'chrome',
          browserLaunchEnabled: false,
          command
        }),
        ...later.map((apply) => ({apply}))
      ]
    })
  )

  return printed
}

const summaryLines = () =>
  printed
    .filter((entry) => new RegExp(STAMP).test(entry.text))
    .map((entry) => entry.text)

const indexOfText = (needle: string) =>
  printed.findIndex((entry) => entry.text.includes(needle))

describe('the compile line of a build', () => {
  it('says compiled and nothing more when there is nothing to report', async () => {
    await run('build')

    expect(printed).toHaveLength(1)
    expect(printed[0].channel).toBe('log')
    expect(printed[0].text).toMatch(
      new RegExp(`${STAMP}compiled in \\d+ ms\\.$`)
    )
  })

  it('marks one warning', async () => {
    await run('build', diagnostics(1, 0))

    expect(summaryLines()).toEqual([
      expect.stringMatching(
        new RegExp(`${STAMP}compiled with warnings in \\d+ ms\\.$`)
      )
    ])
  })

  it('marks several warnings', async () => {
    await run('build', diagnostics(2, 0))

    expect(summaryLines()).toEqual([
      expect.stringMatching(
        new RegExp(`${STAMP}compiled with warnings in \\d+ ms\\.$`)
      )
    ])
  })

  it('marks one error', async () => {
    await run('build', diagnostics(0, 1))

    expect(summaryLines()).toEqual([
      expect.stringMatching(
        new RegExp(`${STAMP}compiled with errors in \\d+ ms\\.$`)
      )
    ])
  })

  it('marks errors and warnings together', async () => {
    await run('build', diagnostics(2, 3))

    expect(summaryLines()).toEqual([
      expect.stringMatching(
        new RegExp(`${STAMP}compiled with errors in \\d+ ms\\.$`)
      )
    ])
  })

  it('leaves the diagnostics to the caller', async () => {
    await run('build', diagnostics(1, 1))

    expect(printed).toHaveLength(1)
  })

  it('misses an error a later done tap adds', async () => {
    await run('build', (compiler) => {
      compiler.hooks.done.tap('spec:late-error', (stats) => {
        stats.compilation.errors.push(new Error('late error') as never)
      })
    })

    expect(summaryLines()).toEqual([
      expect.stringMatching(new RegExp(`${STAMP}compiled in \\d+ ms\\.$`))
    ])
  })

  it('misses a warning a later done tap adds', async () => {
    await run('build', (compiler) => {
      compiler.hooks.done.tap('spec:late-warning', (stats) => {
        stats.compilation.warnings.push(new Error('late warning') as never)
      })
    })

    expect(summaryLines()).toEqual([
      expect.stringMatching(new RegExp(`${STAMP}compiled in \\d+ ms\\.$`))
    ])
  })

  it('prints a line for a build a later done tap throws out of', async () => {
    const failure = run('build', (compiler) => {
      compiler.hooks.done.tapPromise('spec:late-throw', async () => {
        throw new Error('late throw')
      })
    })

    await expect(failure).rejects.toThrow('late throw')
    expect(summaryLines()).toHaveLength(1)
  })
})

describe('the compile line of a dev compile', () => {
  it('says compiled and nothing more when there is nothing to report', async () => {
    await run('dev')

    expect(printed).toHaveLength(1)
    expect(printed[0].text).toMatch(
      new RegExp(`${STAMP}compiled in \\d+ ms\\.$`)
    )
  })

  it('comes before the warnings it marks', async () => {
    await run('dev', diagnostics(2, 0))

    expect(summaryLines()).toEqual([
      expect.stringMatching(
        new RegExp(`${STAMP}compiled with warnings in \\d+ ms\\.$`)
      )
    ])

    expect(printed.map((entry) => entry.channel)).toEqual(['log', 'warn'])
    expect(printed[1].text).toContain('spec warning 1')
    expect(printed[1].text).toContain('spec warning 2')
    expect(indexOfText('Real Name compiled')).toBeLessThan(
      indexOfText('spec warning 1')
    )
  })

  it('comes before the errors it marks', async () => {
    await run('dev', diagnostics(1, 2))

    expect(summaryLines()).toEqual([
      expect.stringMatching(
        new RegExp(`${STAMP}compiled with errors in \\d+ ms\\.$`)
      )
    ])

    expect(printed.map((entry) => entry.channel)).toEqual(['log', 'error'])
    expect(printed[1].text).toContain('spec error 2')
    expect(printed[1].text).toContain('spec warning 1')
    expect(indexOfText('Real Name compiled')).toBeLessThan(
      indexOfText('spec error 1')
    )
  })
})
