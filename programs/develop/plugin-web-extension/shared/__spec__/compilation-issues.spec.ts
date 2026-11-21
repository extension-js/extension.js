import * as fs from 'node:fs'
import * as path from 'node:path'
import {type Compilation, type Compiler, rspack, type Stats} from '@rspack/core'
import {describe, expect, it} from 'vitest'
import {trackTempFolders} from '../../../__spec__/helpers/temp-folders'
import {compilationDiagnostics} from '../../../lib/compilation-diagnostics'
import {reportToCompilation} from '../compilation-issues'

// The bundler frames every pushed issue (glyph, indent, trailing newline), so
// the de-duplication only counts when a real compilation holds the list.
const tempFolder = trackTempFolders()

function compile(
  report: (compilation: Compilation, compiler: Compiler) => void
): Promise<Stats> {
  const root = tempFolder('extjs-issues-')
  fs.writeFileSync(path.join(root, 'index.js'), 'console.log(1)\n')

  const compiler = rspack({
    mode: 'development',
    context: root,
    devtool: false,
    entry: './index.js',
    output: {path: path.join(root, 'dist')}
  })

  compiler.hooks.thisCompilation.tap('report', (compilation) => {
    compilation.hooks.processAssets.tap('report', () =>
      report(compilation, compiler)
    )
  })

  return new Promise((resolve, reject) => {
    compiler.run((error, stats) => {
      compiler.close(() => {})
      if (error || !stats) reject(error ?? new Error('no stats'))
      else resolve(stats)
    })
  })
}

function printedBlocks(stats: Stats, heading: 'WARNING' | 'ERROR') {
  return stats
    .toString({colors: false, all: false, errors: true, warnings: true})
    .split('\n')
    .filter((line) => line.startsWith(heading))
}

describe('reportToCompilation', () => {
  it('says a repeated warning once, printed and in machine output', async () => {
    const stats = await compile((compilation, compiler) => {
      for (let i = 0; i < 3; i++) {
        reportToCompilation(
          compilation,
          compiler,
          'Page script missing.',
          'warning',
          'pages/a.html'
        )
      }
    })

    expect(printedBlocks(stats, 'WARNING')).toEqual(['WARNING in pages/a.html'])

    expect(stats.toJson({all: false, warnings: true}).warnings).toHaveLength(1)
    expect(compilationDiagnostics(stats.compilation).details).toEqual([
      expect.objectContaining({
        message: 'Page script missing.',
        file: 'pages/a.html',
        severity: 'warning'
      })
    ])
  })

  it('says a repeated error once', async () => {
    const stats = await compile((compilation, compiler) => {
      reportToCompilation(compilation, compiler, 'Broken.', 'error', 'a.html')
      reportToCompilation(compilation, compiler, 'Broken.', 'error', 'a.html')
    })

    expect(printedBlocks(stats, 'ERROR')).toEqual(['ERROR in a.html'])
    expect(compilationDiagnostics(stats.compilation).details).toHaveLength(1)
  })

  it('keeps issues that differ in file, text or severity', async () => {
    const stats = await compile((compilation, compiler) => {
      reportToCompilation(compilation, compiler, 'Same.', 'warning', 'a.html')
      reportToCompilation(compilation, compiler, 'Same.', 'warning', 'b.html')
      reportToCompilation(compilation, compiler, 'Other.', 'warning', 'a.html')
      reportToCompilation(compilation, compiler, 'Same.', 'error', 'a.html')
      reportToCompilation(compilation, compiler, 'Same.', 'warning')
    })

    expect(printedBlocks(stats, 'WARNING')).toHaveLength(4)
    expect(printedBlocks(stats, 'ERROR')).toHaveLength(1)
    expect(compilationDiagnostics(stats.compilation).details).toHaveLength(5)
  })
})
