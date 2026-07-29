import {describe, expect, it, vi} from 'vitest'
import {
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
  const legacyBody = '  ⚠ The manifest uses a deprecated path.\n  │ PATH x'
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
    expect(isEmitTimeWarning({message: 'no code'})).toBe(false)
    expect(isEmitTimeWarning('a warning')).toBe(false)
    expect(isEmitTimeWarning(null)).toBe(false)
  })
})
