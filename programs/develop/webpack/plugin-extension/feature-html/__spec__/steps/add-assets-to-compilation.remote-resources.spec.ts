import {describe, it, expect} from 'vitest'
import * as path from 'path'
import {AddAssetsToCompilation} from '../../steps/add-assets-to-compilation'

function makeCompiler(htmlAbsPath: string, htmlContent: string) {
  const warnings: any[] = []

  const compilation = {
    warnings,
    hooks: {
      processAssets: {
        tap: (_: any, cb: any) => cb()
      }
    },
    getAsset: (name: string) => {
      if (name === path.basename(htmlAbsPath)) {
        return {source: {source: () => htmlContent}}
      }
      return undefined
    }
  } as any

  const compiler = {
    options: {context: path.dirname(htmlAbsPath)},
    hooks: {
      thisCompilation: {
        tap: (_: any, fn: any) => fn(compilation)
      }
    },
    rspack: {WebpackError: Error}
  } as any

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
    } as any).apply(compiler)

    expect(compilation.warnings.length).toBeGreaterThanOrEqual(2)
    const messages = compilation.warnings.map((w: any) => String(w.message))
    expect(messages.join('\n')).toMatch(/Remote <(script|style)>/i)
  })
})
