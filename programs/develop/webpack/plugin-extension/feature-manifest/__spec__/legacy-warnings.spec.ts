import {describe, it, expect} from 'vitest'
import {ManifestLegacyWarnings} from '../steps/legacy-warnings'

describe('ManifestLegacyWarnings', () => {
  it('pushes warnings when legacy paths exist in manifest asset', () => {
    const warnings: any[] = []
    const compiler: any = {
      options: {mode: 'development'},
      hooks: {
        thisCompilation: {
          tap: (_n: string, fn: any) =>
            fn({
              getAsset: () => ({
                source: {
                  source: () =>
                    '{"name":"x","foo":"bar","background":{"page":"devtools_page/devtools_page.html"}}'
                }
              }),
              warnings
            })
        }
      }
    }

    new ManifestLegacyWarnings().apply(compiler)

    expect(warnings.length).toBeGreaterThan(0)
  })
})

