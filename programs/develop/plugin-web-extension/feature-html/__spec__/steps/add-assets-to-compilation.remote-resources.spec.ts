import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {
  asCompiler,
  type TapCallback
} from '../../../__spec__/helpers/rspack-fakes'
import {AddAssetsToCompilation} from '../../steps/add-assets-to-compilation'
import type {BuildIssue} from '../helpers/html-fakes'

function makeCompiler(htmlAbsPath: string, htmlContent: string) {
  const warnings: BuildIssue[] = []

  const compilation = {
    errors: [],
    warnings,
    hooks: {
      processAssets: {
        tap: (_: unknown, cb: TapCallback) => cb()
      }
    },
    // The page asset is named after its include-list key, as the emit step
    // names it.
    getAsset: (name: string) => {
      if (name === 'feature.html') {
        return {source: {source: () => htmlContent}}
      }

      return undefined
    }
  }

  const compiler = {
    options: {context: path.dirname(htmlAbsPath)},
    hooks: {
      thisCompilation: {
        tap: (_: unknown, fn: TapCallback) => fn(compilation)
      }
    },
    rspack: {WebpackError: Error}
  }

  return {compiler, compilation}
}

describe('AddAssetsToCompilation - remote resources warnings', () => {
  it('emits warnings for remote <script> and <link>', () => {
    const htmlAbs = path.join(process.cwd(), 'index.html')
    const html = [
      '<html>',
      '<head><link rel="stylesheet" href="https://cdn.example.com/x.css"></head>',
      '<body><script src="//cdn.example.com/x.js"></script></body>',
      '</html>'
    ].join('')

    const {compiler, compilation} = makeCompiler(htmlAbs, html)

    new AddAssetsToCompilation({
      manifestPath: path.join(process.cwd(), 'manifest.json'),
      includeList: {feature: htmlAbs}
    }).apply(asCompiler(compiler))

    expect(compilation.warnings.length).toBeGreaterThanOrEqual(2)
    const messages = compilation.warnings.map((w) => String(w.message))
    expect(messages.join('\n')).toMatch(/loads a remote <(script|link)>/i)
  })
})
