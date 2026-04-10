import {describe, it, expect} from 'vitest'
import * as path from 'path'

describe('ResolvePlugin wiring', () => {
  it('injects a loader rule scoped to the manifest directory', async () => {
    const {ResolvePlugin} = await import('..')

    const rules: any[] = []
    const compiler: any = {
      options: {
        mode: 'development',
        context: '/abs/project',
        module: {rules}
      },
      hooks: {
        thisCompilation: {tap: (_: any, __: any) => {}},
        compilation: {tap: (_: any, __: any) => {}},
        make: {tapAsync: (_: any, __: any) => {}},
        afterPlugins: {tap: (_: any, __: any) => {}},
        afterEmit: {tap: (_: any, __: any) => {}}
      },
      rspack: {WebpackError: Error}
    }

    const manifestPath = '/abs/project/manifest.json'
    const plugin = new ResolvePlugin({manifestPath} as any)
    plugin.apply(compiler)

    expect(rules.length).toBeGreaterThan(0)
    const rule = rules.find(
      (r) =>
        Array.isArray(r.use) &&
        String(r.use[0]?.loader).includes(
          path.join('feature-resolve', 'resolve-paths-loader')
        )
    )
    expect(rule).toBeTruthy()
    expect(rule.include?.[0]).toBe(path.dirname(manifestPath))
  })
})
