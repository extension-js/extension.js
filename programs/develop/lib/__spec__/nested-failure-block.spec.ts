import {describe, expect, it} from 'vitest'
import * as messages from '../messages'

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g
const GLYPH = /⏵⏵⏵/g

// The refusal a launcher or a step throws is a block of its own. Wrapped
// whole, the terminal showed two glyph lines for one failure.
const framed =
  "⏵⏵⏵ Can't find a Chromium binary at the given path.\n" +
  'NOT FOUND /nowhere/chrome\n' +
  'Pass --chromium-binary <abs-path> with a working path.'

describe('a dev failure block that wraps a framed refusal', () => {
  it('keeps one glyph in the launch failure block', () => {
    const block = messages
      .browserLaunchFailed('chrome', framed)
      .replace(ANSI, '')

    expect(block.match(GLYPH)).toHaveLength(1)
    expect(block).toContain("Chrome couldn't start")
    expect(block).toContain("Can't find a Chromium binary at the given path.")
    expect(block).toContain('NOT FOUND /nowhere/chrome')
    expect(block).toContain('The dev server keeps watching')
  })

  it('keeps one glyph in the dev command failure block', () => {
    const block = messages.devCommandFailed(new Error(framed)).replace(ANSI, '')

    expect(block.match(GLYPH)).toHaveLength(1)
    expect(block).toContain('Dev mode failed.')
    expect(block).toContain('NOT FOUND /nowhere/chrome')
  })

  it('leaves a plain reason as it was', () => {
    const block = messages
      .browserLaunchFailed('firefox', 'spawn /x/firefox EACCES')
      .replace(ANSI, '')

    expect(block.match(GLYPH)).toHaveLength(1)
    expect(block).toContain('spawn /x/firefox EACCES')
  })
})
