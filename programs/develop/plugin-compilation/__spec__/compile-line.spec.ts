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
function diagnostics(warnings: number, errors: number, printedAtEmit = 0) {
  return (compiler: Compiler) => {
    compiler.hooks.thisCompilation.tap('spec:diagnostics', (compilation) => {
      for (let index = 1; index <= warnings; index++) {
        compilation.warnings.push(new Error(`spec warning ${index}`) as never)
      }

      // The manifest plugin prints these itself and marks them by name.
      for (let index = 1; index <= printedAtEmit; index++) {
        const warning = new Error(`spec emit warning ${index}`)

        warning.name = 'ManifestLegacyWarning'
        compilation.warnings.push(warning as never)
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

// The whole line after the name, so a stray word fails the match.
const lineEnding = (tail: string) => [
  expect.stringMatching(new RegExp(`${STAMP}${tail}$`))
]

describe('the compile line of a build', () => {
  it('says compiled and nothing more when there is nothing to report', async () => {
    await run('build')

    expect(printed).toHaveLength(1)
    expect(printed[0].channel).toBe('log')
    expect(summaryLines()).toEqual(lineEnding(String.raw`compiled in \d+ ms\.`))
  })

  it('counts one warning and says it is listed below', async () => {
    await run('build', diagnostics(1, 0))

    expect(summaryLines()).toEqual(
      lineEnding(String.raw`compiled with 1 warning in \d+ ms, listed below\.`)
    )
  })

  it('counts several warnings', async () => {
    await run('build', diagnostics(3, 0))

    expect(summaryLines()).toEqual(
      lineEnding(String.raw`compiled with 3 warnings in \d+ ms, listed below\.`)
    )
  })

  it('points both ways when a plugin printed some warnings at emit', async () => {
    await run('build', diagnostics(1, 0, 1))

    expect(summaryLines()).toEqual(
      lineEnding(
        String.raw`compiled with 2 warnings in \d+ ms, listed above and below\.`
      )
    )
  })

  it('points nowhere when every warning was printed at emit', async () => {
    await run('build', diagnostics(0, 0, 2))

    expect(summaryLines()).toEqual(
      lineEnding(String.raw`compiled with 2 warnings in \d+ ms\.`)
    )
  })

  it('says a compile with one error failed', async () => {
    await run('build', diagnostics(0, 1))

    expect(summaryLines()).toEqual(
      lineEnding(String.raw`failed to compile with 1 error in \d+ ms\.`)
    )

    expect(summaryLines()[0]).not.toMatch(/ compiled /)
  })

  it('counts errors and warnings together', async () => {
    await run('build', diagnostics(2, 3))

    expect(summaryLines()).toEqual(
      lineEnding(
        String.raw`failed to compile with 3 errors and 2 warnings in \d+ ms\.`
      )
    )
  })

  it('counts one error and one warning in the singular', async () => {
    await run('build', diagnostics(1, 1))

    expect(summaryLines()).toEqual(
      lineEnding(
        String.raw`failed to compile with 1 error and 1 warning in \d+ ms\.`
      )
    )
  })

  it('leaves the diagnostics to the caller', async () => {
    await run('build', diagnostics(1, 1))

    expect(printed).toHaveLength(1)
  })

  it('counts an error a later done tap adds', async () => {
    await run('build', (compiler) => {
      compiler.hooks.done.tap('spec:late-error', (stats) => {
        stats.compilation.errors.push(new Error('late error') as never)
      })
    })

    expect(summaryLines()).toEqual(
      lineEnding(String.raw`failed to compile with 1 error in \d+ ms\.`)
    )
  })

  it('counts a warning a later done tap adds', async () => {
    await run('build', (compiler) => {
      compiler.hooks.done.tap('spec:late-warning', (stats) => {
        stats.compilation.warnings.push(new Error('late warning') as never)
      })
    })

    expect(summaryLines()).toEqual(
      lineEnding(String.raw`compiled with 1 warning in \d+ ms, listed below\.`)
    )
  })

  it('prints no line for a build a later done tap throws out of', async () => {
    const failure = run('build', (compiler) => {
      compiler.hooks.done.tapPromise('spec:late-throw', async () => {
        throw new Error('late throw')
      })
    })

    await expect(failure).rejects.toThrow('late throw')
    expect(printed).toEqual([])
  })
})

describe('the compile line of a dev compile', () => {
  it('says compiled and nothing more when there is nothing to report', async () => {
    await run('dev')

    expect(printed).toHaveLength(1)
    expect(summaryLines()).toEqual(lineEnding(String.raw`compiled in \d+ ms\.`))
  })

  it('comes after the warnings it counts and points nowhere', async () => {
    await run('dev', diagnostics(2, 0))

    expect(summaryLines()).toEqual(
      lineEnding(String.raw`compiled with 2 warnings in \d+ ms\.`)
    )

    expect(printed.map((entry) => entry.channel)).toEqual(['warn', 'log'])
    expect(printed[0].text).toContain('spec warning 1')
    expect(printed[0].text).toContain('spec warning 2')
    expect(indexOfText('spec warning 2')).toBeLessThan(
      indexOfText('Real Name compiled')
    )
  })

  it('comes after the errors it counts', async () => {
    await run('dev', diagnostics(1, 2))

    expect(summaryLines()).toEqual(
      lineEnding(
        String.raw`failed to compile with 2 errors and 1 warning in \d+ ms\.`
      )
    )

    expect(printed.map((entry) => entry.channel)).toEqual(['error', 'log'])
    expect(printed[0].text).toContain('spec error 2')
    expect(printed[0].text).toContain('spec warning 1')
    expect(indexOfText('spec error 2')).toBeLessThan(
      indexOfText('Real Name failed to compile')
    )
  })

  it('stays ahead of a tap registered after the plugin', async () => {
    await run('dev', (compiler) => {
      compiler.hooks.done.tap('spec:card', () => console.log('the card'))
    })

    expect(printed.map((entry) => entry.text)).toEqual([
      expect.stringMatching(new RegExp(`${STAMP}compiled in \\d+ ms\\.$`)),
      'the card'
    ])
  })
})
