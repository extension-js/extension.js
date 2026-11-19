import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {getBuildSummary, stripLoaderWrapper} from '../build-summary'
import {toDiagnostic} from '../compilation-diagnostics'

const LOADER = '/abs/node_modules (copy)/extension-develop/dist/guard.mjs'
const REPORTED =
  `  ⚠ Module Warning (from ${LOADER}):\n` +
  "  │ The CSS in this file doesn't parse.\n" +
  '  │ PATH content/styles.css\n'

describe('stripLoaderWrapper', () => {
  it('drops the line that names the loader file', () => {
    expect(
      stripLoaderWrapper(`Module Warning (from ${LOADER}):\nThe text.`)
    ).toBe('The text.')

    expect(stripLoaderWrapper(`Module Error (from ${LOADER}):\nBroke.`)).toBe(
      'Broke.'
    )
  })

  it('keeps the head marker and reads the first gutter off', () => {
    expect(stripLoaderWrapper(REPORTED)).toBe(
      "  ⚠ The CSS in this file doesn't parse.\n  │ PATH content/styles.css\n"
    )
  })

  it('leaves a message that names no loader as written', () => {
    const text = 'Module not found: (from here): no'
    expect(stripLoaderWrapper(text)).toBe(text)
  })
})

describe('a loader warning on the machine channel', () => {
  it('reads without the loader path in the build summary', () => {
    const key = REPORTED.trim()
    const coded = getBuildSummary(
      'chrome',
      {warnings: [{message: REPORTED}]},
      undefined,
      undefined,
      new Map([[key, 'E_CSS_PARSE']])
    )
    const plain = getBuildSummary('chrome', {warnings: [{message: REPORTED}]})

    expect(coded.warnings).toEqual([
      "E_CSS_PARSE: The CSS in this file doesn't parse.\nPATH content/styles.css"
    ])

    expect(plain.warnings).toEqual([
      "The CSS in this file doesn't parse.\nPATH content/styles.css"
    ])
  })

  it('names a file inside the project from the project root', () => {
    const project = path.resolve(path.sep, 'work', 'ext')
    const summary = getBuildSummary(
      'chrome',
      {
        warnings: [
          {
            message:
              "  ⚠ Can't find the page listed in sandbox.pages.\n" +
              `  │ NOT FOUND ${path.join(project, 'sandbox', 'missing.html')}\n`
          }
        ]
      },
      undefined,
      undefined,
      undefined,
      project
    )

    expect(summary.warnings).toEqual([
      "Can't find the page listed in sandbox.pages.\nNOT FOUND sandbox/missing.html"
    ])
  })

  it('reads without the loader path in a diagnostic', () => {
    const issue = Object.assign(new Error(REPORTED), {name: 'CssParseWarning'})

    expect(toDiagnostic(issue, 'warning')).toEqual({
      code: 'E_CSS_PARSE',
      message: "The CSS in this file doesn't parse.\nPATH content/styles.css",
      severity: 'warning',
      name: 'CssParseWarning'
    })
  })
})
