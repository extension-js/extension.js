import {describe, expect, it} from 'vitest'
import {buildWarningsDetails} from '../messages'

// biome-ignore lint/suspicious/noControlCharactersInRegex: the escape byte is the thing matched
const stripAnsi = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, '')

const sizeWarning = (limit: string) => ({
  message: `asset size limit: The following asset(s) exceed the recommended size limit (${limit}). This can impact web performance.`,
  details: 'Assets:\n  background/service_worker.js (1.560 MiB)',
  pluginName: 'rspack/performance-hints',
  file: 'background/service_worker.js'
})

describe('the block a size limit warning prints', () => {
  it.each([
    '500 bytes',
    '1 byte',
    '244.141 KiB',
    '1.5 MiB'
  ])('names the threshold %s', (limit) => {
    const block = stripAnsi(buildWarningsDetails([sizeWarning(limit)]))

    expect(block).toContain(`Threshold: ${limit}`)
  })

  it('names the build as the source, and no bundler', () => {
    const block = stripAnsi(buildWarningsDetails([sizeWarning('244.141 KiB')]))

    expect(block).toContain('Source: build size limits')
    expect(block).not.toMatch(/rspack|webpack/i)
  })

  it('keeps a source that is not a bundler plugin', () => {
    const block = stripAnsi(
      buildWarningsDetails([
        {...sizeWarning('244.141 KiB'), pluginName: 'perf-budgets'}
      ])
    )

    expect(block).toContain('Source: perf-budgets')
  })
})
