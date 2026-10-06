import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {type Compiler, rspack, type Stats} from '@rspack/core'
import {afterAll, describe, expect, it, vi} from 'vitest'
import {
  humanizeCaseMismatchBlocks,
  isEmitTimeWarning,
  renderStatsBlocks,
  wrapStatsBlocks
} from '../stats-handler'

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\u001b\[[0-9;]*m/g

function plain(input: string): string {
  return input.replace(ANSI_PATTERN, '')
}

describe('wrapStatsBlocks', () => {
  it('replaces an ERROR head line with the standard error header', () => {
    const raw = [
      'ERROR in ./src/index.ts',
      '  × Unexpected token',
      '   ╭─[1:1]',
      ' 1 │ cons t x = 1',
      '   ·      ─',
      '   ╰────'
    ].join('\n')

    const wrapped = plain(wrapStatsBlocks(raw))
    const lines = wrapped.split('\n')

    expect(lines[0]).toBe('⏵⏵⏵ Build error in ./src/index.ts.')
    expect(wrapped).not.toContain('ERROR in')
  })

  it('keeps the diagnostic body verbatim, indented under the header', () => {
    const raw = ['ERROR in ./src/index.ts', '  × Unexpected token'].join('\n')

    const lines = plain(wrapStatsBlocks(raw)).split('\n')

    expect(lines[1]).toBe('    × Unexpected token')
  })

  it('wraps each block of a multi-error output separately', () => {
    const raw = [
      'ERROR in ./src/a.ts',
      '  × broken a',
      '',
      'ERROR in ./src/b.ts',
      '  × broken b'
    ].join('\n')

    const wrapped = plain(wrapStatsBlocks(raw))

    expect(wrapped).toContain('⏵⏵⏵ Build error in ./src/a.ts.')
    expect(wrapped).toContain('⏵⏵⏵ Build error in ./src/b.ts.')
    expect(wrapped).toContain('    × broken a')
    expect(wrapped).toContain('    × broken b')
  })

  it('renders WARNING head lines as warning headers', () => {
    const raw = ['WARNING in ./src/w.ts', '  ⚠ asset size limit'].join('\n')

    const wrapped = plain(wrapStatsBlocks(raw))

    expect(wrapped).toContain('⏵⏵⏵ Build warning in ./src/w.ts.')
    expect(wrapped).not.toContain('WARNING in')
  })

  it('detects a head line even when the bundler colored it', () => {
    const raw = `\u001b[1m\u001b[31mERROR\u001b[39m\u001b[22m in ./src/red.ts\n  × broken`

    const wrapped = plain(wrapStatsBlocks(raw))

    expect(wrapped).toContain('⏵⏵⏵ Build error in ./src/red.ts.')
  })

  it('labels a head line with no module as a bare build error', () => {
    const wrapped = plain(wrapStatsBlocks('ERROR\n  × broken'))

    expect(wrapped.split('\n')[0]).toBe('⏵⏵⏵ Build error.')
  })

  it('keeps the message of a warning with no file out of the header', () => {
    const raw = [
      '\u001b[1m\u001b[33mWARNING\u001b[39m\u001b[22m in \u001b[33m⚠\u001b[0m The folder sits in a legacy place.',
      '  \u001b[2m│\u001b[0m GOT src/_locales',
      '  \u001b[2m│\u001b[0m EXPECTED _locales'
    ].join('\n')

    expect(plain(wrapStatsBlocks(raw)).split('\n')).toEqual([
      '⏵⏵⏵ Build warning.',
      '    ⚠ The folder sits in a legacy place.',
      '    │ GOT src/_locales',
      '    │ EXPECTED _locales'
    ])
  })

  it('keeps the message of an error with no file out of the header', () => {
    const raw = [
      '\u001b[1m\u001b[31mERROR\u001b[39m\u001b[22m in \u001b[1m  × The manifest names no entry.',
      '  │ Add one.'
    ].join('\n')

    expect(plain(wrapStatsBlocks(raw)).split('\n')).toEqual([
      '⏵⏵⏵ Build error.',
      '    × The manifest names no entry.',
      '    │ Add one.'
    ])
  })
})

describe('renderStatsBlocks on what the bundler prints', () => {
  const roots: string[] = []

  afterAll(() => {
    for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
  })

  function compileWithWarnings() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-stats-head-'))
    roots.push(root)
    fs.writeFileSync(path.join(root, 'index.js'), 'export const value = 1\n')

    const compiler = rspack({
      context: root,
      mode: 'development',
      entry: './index.js',
      output: {path: path.join(root, 'out')},
      plugins: [
        {
          apply(target: Compiler) {
            target.hooks.thisCompilation.tap('spec-warnings', (compilation) => {
              const WarningCtor = target.rspack.WebpackError
              const located = new WarningCtor(
                'stats-head-token: with a file.\nFix the file.'
              ) as Error & {file?: string}
              located.file = 'manifest.json'

              compilation.warnings.push(
                new WarningCtor('stats-head-token: no file.\nGOT here'),
                located
              )
            })
          }
        }
      ]
    })

    return new Promise<Stats>((resolve, reject) => {
      compiler.run((error, stats) => {
        compiler.close(() => {
          if (error || !stats) return reject(error || new Error('no stats'))

          resolve(stats)
        })
      })
    })
  }

  it('names a file only for the warning that has one', async () => {
    const stats = await compileWithWarnings()
    const lines = plain(
      renderStatsBlocks(stats, {errors: false, warnings: true})
    )
      .split('\n')
      .filter((line) => line.trim().length > 0)

    expect(lines).toEqual([
      '⏵⏵⏵ Build warning.',
      '    ⚠ stats-head-token: no file.',
      '    │ GOT here',
      '⏵⏵⏵ Build warning in manifest.json.',
      '    ⚠ stats-head-token: with a file.',
      '    │ Fix the file.'
    ])
  }, 60_000)
})

describe('renderStatsBlocks', () => {
  it('asks the stats object for errors-only output by default shape', () => {
    const statsToString = vi.fn(() => 'ERROR in ./src/x.ts\n  × broken')
    const rendered = plain(
      renderStatsBlocks(
        {toString: statsToString},
        {errors: true, warnings: false}
      )
    )

    expect(statsToString).toHaveBeenCalledWith({
      colors: true,
      all: false,
      errors: true,
      warnings: false
    })

    expect(rendered).toContain('⏵⏵⏵ Build error in ./src/x.ts.')
  })

  it('returns an empty string when the stats output is empty', () => {
    const rendered = renderStatsBlocks(
      {toString: () => ''},
      {errors: true, warnings: true}
    )

    expect(rendered).toBe('')
  })
})

describe('renderStatsBlocks with emit-time warnings', () => {
  const fatalBody = '  ⚠ Repaired the version field.\n  │ Fix it.'
  const legacyBody =
    '  ⚠ The options_ui.page field uses a deprecated scaffold path.\n  │ PATH options_ui/page.html'
  const perfBody = '  ⚠ asset size limit exceeded'

  it('drops a warning block already printed at emit time', () => {
    const stats = {
      toString: () => `WARNING in manifest.json\n${fatalBody}`,
      toJson: () => ({
        warnings: [
          {code: 'ManifestFatalShapeWarning', message: `${fatalBody}\n`}
        ]
      })
    }

    const rendered = renderStatsBlocks(stats, {errors: false, warnings: true})

    expect(rendered).toBe('')
  })

  it('drops the legacy-path warning block the same way', () => {
    const stats = {
      toString: () => `WARNING in manifest.json\n${legacyBody}`,
      toJson: () => ({
        warnings: [{code: 'ManifestLegacyWarning', message: `${legacyBody}\n`}]
      })
    }

    const rendered = renderStatsBlocks(stats, {errors: false, warnings: true})

    expect(rendered).toBe('')
  })

  it('keeps unmarked warnings while dropping marked ones', () => {
    const stats = {
      toString: () =>
        [
          'WARNING in manifest.json',
          fatalBody,
          '',
          'WARNING in ./src/big.ts',
          perfBody
        ].join('\n'),
      toJson: () => ({
        warnings: [
          {code: 'ManifestFatalShapeWarning', message: `${fatalBody}\n`},
          {message: `${perfBody}\n`}
        ]
      })
    }

    const rendered = plain(
      renderStatsBlocks(stats, {errors: false, warnings: true})
    )

    expect(rendered).toContain('⏵⏵⏵ Build warning in ./src/big.ts.')
    expect(rendered).toContain('asset size limit exceeded')
    expect(rendered).not.toContain('Repaired the version field.')
  })

  it('keeps error blocks while dropping marked warning blocks', () => {
    const stats = {
      toString: () =>
        [
          'ERROR in ./src/a.ts',
          '  × broken a',
          '',
          'WARNING in manifest.json',
          fatalBody
        ].join('\n'),
      toJson: () => ({
        warnings: [
          {code: 'ManifestFatalShapeWarning', message: `${fatalBody}\n`}
        ]
      })
    }

    const rendered = plain(
      renderStatsBlocks(stats, {errors: true, warnings: true})
    )

    expect(rendered).toContain('⏵⏵⏵ Build error in ./src/a.ts.')
    expect(rendered).toContain('    × broken a')
    expect(rendered).not.toContain('Repaired the version field.')
  })

  it('renders every warning when the stats object has no toJson', () => {
    const stats = {
      toString: () => `WARNING in manifest.json\n${fatalBody}`
    }

    const rendered = plain(
      renderStatsBlocks(stats, {errors: false, warnings: true})
    )

    expect(rendered).toContain('⏵⏵⏵ Build warning in manifest.json.')
  })
})

describe('isEmitTimeWarning', () => {
  it('marks the two emit-time warning codes and nothing else', () => {
    expect(isEmitTimeWarning({code: 'ManifestFatalShapeWarning'})).toBe(true)
    expect(isEmitTimeWarning({code: 'ManifestLegacyWarning'})).toBe(true)
    expect(isEmitTimeWarning({code: 'AmoDataCollectionWarning'})).toBe(false)
    expect(isEmitTimeWarning({code: undefined})).toBe(false)
    expect(isEmitTimeWarning('a warning')).toBe(false)
    expect(isEmitTimeWarning(null)).toBe(false)
  })
})

describe('humanizeCaseMismatchBlocks', () => {
  const raw = [
    'ERROR in ./sw.js 1:1-22',
    '  \u00d7 Error: [CaseSensitivePathsPlugin] `/proj/Helper.js` does not match the corresponding path on disk `helper.js`.',
    '    \u2502     at /x/case-sensitive-paths-plugin/index.js:170:13',
    '    \u2502     at CaseSensitivePathsPlugin.getFilenamesInDir (/x/index.js:52:5)',
    '    \u2502 ',
    ''
  ].join('\n')

  it('collapses the plugin stack to one clean refusal', () => {
    const out = humanizeCaseMismatchBlocks(raw, false)
    expect(out).toContain(
      '`/proj/Helper.js` does not match its casing on disk: `helper.js`.'
    )

    expect(out).toContain('Case-sensitive filesystems fail this reference.')
    expect(out).not.toContain('at CaseSensitivePathsPlugin')
    expect(out).not.toContain('\u2502')
  })

  it('keeps the stack frames for author mode', () => {
    const out = humanizeCaseMismatchBlocks(raw, true)
    expect(out).toContain(
      '`/proj/Helper.js` does not match its casing on disk: `helper.js`.'
    )

    expect(out).toContain('at CaseSensitivePathsPlugin.getFilenamesInDir')
  })

  it('leaves unrelated error blocks alone', () => {
    const other = 'ERROR in ./a.ts\n  \u00d7 Unexpected token\n'
    expect(humanizeCaseMismatchBlocks(other, false)).toBe(other)
  })
})
