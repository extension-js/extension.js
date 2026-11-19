import {describe, expect, it} from 'vitest'
import {buildWarningsDetails} from '../messages'
import {prefix} from '../messaging'

// eslint-disable-next-line no-control-regex
const ANSI = /\[[0-9;]*m/g
const GLYPH = '⏵⏵⏵'

function plain(text: string) {
  return text.replace(ANSI, '')
}

// The bundler hands the report each warning wrapped in its own reporter's
// frame: a warning-sign marker on the first line, a bar gutter after it.
function reported(message: string) {
  return `${message
    .split('\n')
    .map((line, index) => (index === 0 ? `  ⚠ ${line}` : `  │ ${line}`))
    .join('\n')}\n`
}

describe('buildWarningsDetails', () => {
  it('drops the rspack loader wrapper and keeps the message', () => {
    const out = buildWarningsDetails([
      {
        message:
          'Module Warning (from /abs/path/late-css-import-loader.mjs):\n' +
          'An @import rule comes after other rules, so browsers skip it.\n' +
          'PATH popup/popup.css:3',
        moduleName: './popup/popup.css'
      }
    ])
    expect(out).not.toContain('Module Warning')
    expect(out).not.toContain('late-css-import-loader.mjs')
    expect(out).toContain('An @import rule comes after other rules')
    expect(out).toContain('popup/popup.css:3')
    expect(out).toContain('./popup/popup.css')
  })

  it('leaves warnings without the wrapper untouched', () => {
    const out = buildWarningsDetails(['plain warning text'])
    expect(out).toContain('plain warning text')
  })

  it('prints a warning that opens with the channel glyph as written', () => {
    const text =
      `${prefix('warn')} edge:homepage_url now applies only to Edge builds.\n` +
      'Rename it to chromium:homepage_url to keep it on every Chromium-based browser.'
    const out = plain(
      buildWarningsDetails([{message: reported(text), file: 'manifest.json'}])
    )

    expect(out).toBe(plain(text))
    expect(out.split(GLYPH).length - 1).toBe(1)
    expect(out).not.toContain('⚠')
    expect(out).not.toContain('│')
  })

  it('frames a one-line bundler warning with its source and a hint', () => {
    const out = plain(
      buildWarningsDetails([{message: reported('The legacy option is set.')}])
    )
    const lines = out.split('\n')

    expect(lines[0]).toBe(
      `${GLYPH} Warning: Deprecation: The legacy option is set.`
    )

    expect(lines[1]).toBe('│  Source: bundler')
    expect(lines[2]).toMatch(/^│ {2}Hint: /)
    expect(out).not.toContain('⚠')
  })

  it('skips the generic hint when the warning explains itself', () => {
    const out = plain(
      buildWarningsDetails([
        {
          message: reported(
            'The public folder sits in the legacy next-to-manifest location.\n' +
              'Move the folder to the project root to silence this warning.'
          )
        }
      ])
    )
    const lines = out.split('\n')

    expect(lines[1]).toBe(
      'Move the folder to the project root to silence this warning.'
    )

    expect(lines[2]).toBe('│  Source: bundler')
    expect(lines).toHaveLength(3)
  })

  it('keeps every line of a multi-line warning on its own line', () => {
    const out = plain(
      buildWarningsDetails([
        {
          message: reported(
            'The _locales folder sits in the legacy next-to-manifest location.\n' +
              'GOT src/_locales\n' +
              'EXPECTED _locales\n' +
              'Move the folder to the project root to silence this warning.'
          ),
          file: 'manifest.json'
        }
      ])
    )

    expect(out.split('\n')).toEqual([
      `${GLYPH} Warning: Deprecation: The _locales folder sits in the legacy next-to-manifest location. (manifest.json)`,
      'GOT src/_locales',
      'EXPECTED _locales',
      'Move the folder to the project root to silence this warning.',
      '│  Source: bundler'
    ])
  })

  // The bundler colors its code frame when FORCE_COLOR is merely present,
  // and its marker then sits between two codes.
  it('prints the bundler frame plain when the stream takes no color', () => {
    const esc = String.fromCharCode(27)
    const colored =
      `  ${esc}[33m⚠${esc}[0m Critical dependency: the request is an expression\n` +
      `  ${esc}[2m1${esc}[0m │ return import(name);\n`
    const saved = {
      NO_COLOR: process.env.NO_COLOR,
      FORCE_COLOR: process.env.FORCE_COLOR
    }

    try {
      delete process.env.NO_COLOR
      process.env.FORCE_COLOR = '0'
      const out = buildWarningsDetails([
        {message: colored, moduleName: './shared.js'}
      ])

      expect(out).toBe(plain(out))
      expect(out.split('\n')[0]).toBe(
        `${GLYPH} Warning: Critical dependency: the request is an expression (./shared.js)`
      )

      process.env.FORCE_COLOR = '1'
      const kept = buildWarningsDetails([
        {message: colored, moduleName: './shared.js'}
      ])

      expect(kept).toContain(`${esc}[2m1${esc}[0m`)
      expect(plain(kept).split('\n')[0]).toBe(
        `${GLYPH} Warning: Critical dependency: the request is an expression (./shared.js)`
      )
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  })
})
