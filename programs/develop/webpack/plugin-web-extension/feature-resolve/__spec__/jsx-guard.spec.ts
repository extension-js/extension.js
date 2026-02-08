import {describe, it, expect} from 'vitest'

async function runLoader(
  source: string,
  opts?: Partial<{manifestPath: string; resourcePath: string}>
): Promise<{code: string; map: any; warnings: (Error | string)[]}> {
  return new Promise(async (resolve, reject) => {
    const warnings: (Error | string)[] = []
    let lastMap: any
    const mod = await import('../resolve-paths-loader')
    const loader = (mod as any).default || (mod as any)
    const context: any = {
      resourcePath: opts?.resourcePath || '/abs/project/src/file.tsx',
      async() {
        return (err: any, result: any, map: any) => {
          if (err) return reject(err)
          lastMap = map
          resolve({code: String(result ?? ''), map: lastMap, warnings})
        }
      },
      getOptions() {
        return {
          manifestPath: opts?.manifestPath || '/abs/project/manifest.json',
          mode: 'development'
        }
      },
      emitWarning: (e: any) => warnings.push(e)
    }
    loader.call(context, source)
  })
}

describe('jsx/tsx guard', () => {
  it('does not rewrite inside JSX attributes', async () => {
    const code = `
      const el = <img src="/public/a.png" />
      export default el
    `
    const {code: out} = await runLoader(code, {
      resourcePath: '/abs/project/src/file.tsx'
    })
    expect(out).toContain('<img src="/public/a.png"')
  })
})
