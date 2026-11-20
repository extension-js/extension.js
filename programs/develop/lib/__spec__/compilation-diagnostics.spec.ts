import * as fs from 'node:fs'
import * as path from 'node:path'
import {rspack, type Stats} from '@rspack/core'
import {describe, expect, it} from 'vitest'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import {MAX_SUMMARY_WARNINGS} from '../build-summary'
import {
  compilationDiagnostics,
  toDiagnostic,
  warningCodes
} from '../compilation-diagnostics'

const makeTempFolder = trackTempFolders()

function named(name: string, message: string): Error {
  const error = new Error(message)
  error.name = name

  return error
}

describe('toDiagnostic', () => {
  it('peels the color, the glyph and the gutter the bundler renders', () => {
    const rendered =
      '\u001b[31m  × \u001b[0mModule build failed:\n  │ first line\n  │ second line\n'

    expect(toDiagnostic({message: rendered}, 'error')).toEqual({
      message: 'Module build failed:\nfirst line\nsecond line',
      severity: 'error'
    })

    expect(toDiagnostic('  ⚠ plain text warning', 'warning')).toEqual({
      message: 'plain text warning',
      severity: 'warning'
    })
  })

  it('names the file, the line and the column when the issue has them', () => {
    expect(
      toDiagnostic(
        {
          message: 'bad',
          file: 'src/a.ts',
          loc: {start: {line: 3, column: 7}}
        },
        'error'
      )
    ).toEqual({
      message: 'bad',
      file: 'src/a.ts',
      line: 3,
      column: 7,
      severity: 'error'
    })

    // A position that is not a number is left out, not printed as NaN.
    expect(
      toDiagnostic(
        {message: 'bad', loc: {start: {line: '3', column: Number.NaN}}},
        'error'
      )
    ).toEqual({message: 'bad', severity: 'error'})
  })

  it('names a module by its path inside the project, in forward slashes', () => {
    const root = fs.realpathSync.native(makeTempFolder('extjs-diagnostics-'))
    const resource = path.join(root, 'src', 'pages', 'a.ts')

    expect(
      toDiagnostic({message: 'bad', module: {resource}}, 'error', root).file
    ).toBe('src/pages/a.ts')
  })

  it('names it the same way when the root is a link to where it sits', () => {
    const base = fs.realpathSync.native(makeTempFolder('extjs-diagnostics-'))
    const real = path.join(base, 'real')
    const linked = path.join(base, 'linked')

    fs.mkdirSync(path.join(real, 'src'), {recursive: true})
    fs.symlinkSync(real, linked, 'dir')

    expect(
      toDiagnostic(
        {message: 'bad', module: {resource: path.join(real, 'src', 'a.ts')}},
        'error',
        linked
      ).file
    ).toBe('src/a.ts')
  })

  it('leaves a module outside the project, or with no root, as it came', () => {
    const root = fs.realpathSync.native(makeTempFolder('extjs-diagnostics-'))
    const outside = path.join(path.dirname(root), 'elsewhere', 'a.ts')

    expect(
      toDiagnostic({message: 'bad', module: {resource: outside}}, 'error', root)
        .file
    ).toBe(outside)

    expect(
      toDiagnostic({message: 'bad', module: {resource: outside}}, 'error').file
    ).toBe(outside)

    expect(
      toDiagnostic(
        {message: 'bad', module: {resource: './a.ts'}},
        'error',
        root
      ).file
    ).toBe('./a.ts')
  })

  it('carries the name a plugin gave and the code that name maps to', () => {
    expect(
      toDiagnostic(named('PerfBudgetWarning', 'too big'), 'warning')
    ).toEqual({
      code: 'W_PERF_BUDGET',
      message: 'too big',
      severity: 'warning',
      name: 'PerfBudgetWarning'
    })

    // The bare Error name says nothing, so it is left out.
    expect(toDiagnostic(new Error('plain'), 'error')).toEqual({
      message: 'plain',
      severity: 'error'
    })
  })

  it('codes a syntax failure only for a module the context lists', () => {
    const issue = {
      name: 'ModuleBuildError',
      message: 'unexpected token',
      error: {name: 'SyntaxError'},
      module: {resource: '/project/content.js'}
    }

    expect(toDiagnostic(issue, 'error').code).toBeUndefined()
    expect(
      toDiagnostic(issue, 'error', undefined, {
        contentScripts: new Set(['/project/content.js'])
      }).code
    ).toBe('E_CONTENT_SCRIPT_SYNTAX')
  })
})

describe('compilationDiagnostics', () => {
  it('lists errors before warnings, relative to the compiler context', () => {
    const root = fs.realpathSync.native(makeTempFolder('extjs-diagnostics-'))

    expect(
      compilationDiagnostics({
        compiler: {context: root},
        warnings: [named('PerfBudgetWarning', 'too big')],
        errors: [
          {message: 'broke', module: {resource: path.join(root, 'a.js')}}
        ]
      })
    ).toEqual({
      details: [
        {message: 'broke', file: 'a.js', severity: 'error'},
        {
          code: 'W_PERF_BUDGET',
          message: 'too big',
          severity: 'warning',
          name: 'PerfBudgetWarning'
        }
      ],
      truncated: false
    })
  })

  it('prefers the root it is given over the compiler context', () => {
    const root = fs.realpathSync.native(makeTempFolder('extjs-diagnostics-'))
    const resource = path.join(root, 'app', 'a.js')

    expect(
      compilationDiagnostics(
        {
          compiler: {context: root},
          errors: [{message: 'x', module: {resource}}]
        },
        path.join(root, 'app')
      ).details[0].file
    ).toBe('a.js')
  })

  it('stops at the summary cap and says it left some out', () => {
    const warnings = Array.from({length: MAX_SUMMARY_WARNINGS}, (_, index) =>
      named('PerfBudgetWarning', `warning ${index}`)
    )
    const atCap = compilationDiagnostics({warnings})

    expect(atCap.details).toHaveLength(MAX_SUMMARY_WARNINGS)
    expect(atCap.truncated).toBe(false)

    const over = compilationDiagnostics({
      warnings,
      errors: [new Error('the error')]
    })

    expect(over.details).toHaveLength(MAX_SUMMARY_WARNINGS)
    expect(over.truncated).toBe(true)
    // The error is what survives the cap: the last warning is the one cut.
    expect(over.details[0]).toEqual({message: 'the error', severity: 'error'})
    expect(over.details.at(-1)?.message).toBe(
      `warning ${MAX_SUMMARY_WARNINGS - 2}`
    )
  })

  it('answers an empty list for no compilation or one with no issues', () => {
    const empty = {details: [], truncated: false}

    expect(compilationDiagnostics(undefined)).toEqual(empty)
    expect(compilationDiagnostics(null)).toEqual(empty)
    expect(compilationDiagnostics({})).toEqual(empty)
    expect(compilationDiagnostics({errors: 'nope', warnings: 3})).toEqual(empty)
  })

  it('lists the issues uncoded when the chunk graph cannot be read', () => {
    const issue = {
      name: 'ModuleBuildError',
      message: 'unexpected token',
      error: {name: 'SyntaxError'},
      module: {resource: '/project/content.js'}
    }

    expect(
      compilationDiagnostics({
        errors: [issue],
        entrypoints: new Map([['content_scripts/content-0', {chunks: [{}]}]]),
        chunkGraph: {
          getChunkModules: () => {
            throw new Error('no graph')
          }
        }
      }).details[0].code
    ).toBeUndefined()
  })

  // The chunk graph of a real compile is what tells a content script's syntax
  // failure from the same failure in a background script.
  it('codes a real syntax failure only under a content_scripts entry', async () => {
    const root = fs.realpathSync.native(makeTempFolder('extjs-diagnostics-'))

    fs.writeFileSync(path.join(root, 'content.js'), 'const = 1\n')
    fs.writeFileSync(path.join(root, 'background.js'), 'const = 2\n')

    const stats = await new Promise<Stats>((resolve, reject) => {
      rspack(
        {
          context: root,
          mode: 'development',
          devtool: false,
          entry: {
            'content_scripts/content-0': './content.js',
            'background/service_worker': './background.js'
          },
          output: {path: path.join(root, 'dist')},
          // The transpiler is what reports the failure as a build error.
          module: {rules: [{test: /\.js$/, loader: 'builtin:swc-loader'}]}
        },
        (error, result) => (result ? resolve(result) : reject(error))
      )
    })

    const {details} = compilationDiagnostics(stats.compilation)
    const byFile = new Map(details.map((detail) => [detail.file, detail]))

    expect([...byFile.keys()].sort()).toEqual(['background.js', 'content.js'])
    expect(byFile.get('content.js')?.code).toBe('E_CONTENT_SCRIPT_SYNTAX')
    expect(byFile.get('background.js')?.code).toBeUndefined()
    expect(byFile.get('content.js')?.severity).toBe('error')
    expect(byFile.get('content.js')?.message).not.toMatch(/\u001b\[|^\s*×/)
  })
})

describe('warningCodes', () => {
  it('maps the text the summary prints to the code of each coded warning', () => {
    const codes = warningCodes({
      warnings: [
        named('PerfBudgetWarning', '\u001b[33mtoo big\u001b[0m\n'),
        named('HtmlAssetMissing', 'Asset "a.png" was not found'),
        new Error('uncoded'),
        'a bare string'
      ]
    })

    expect([...codes]).toEqual([
      ['too big', 'W_PERF_BUDGET'],
      ['Asset "a.png" was not found', 'W_ASSET_MISSING']
    ])
  })

  it('answers an empty map for no compilation or no warnings', () => {
    expect(warningCodes(undefined).size).toBe(0)
    expect(warningCodes({}).size).toBe(0)
    expect(warningCodes({errors: [named('PerfBudgetWarning', 'x')]}).size).toBe(
      0
    )
  })
})
