import {describe, it, expect} from 'vitest'

async function runLoader(
  source: string,
  opts?: Partial<{
    manifestPath: string
    resourcePath: string
    sourceMap?: boolean
  }>
): Promise<{code: string; map: any; warnings: (Error | string)[]}> {
  return new Promise(async (resolve, reject) => {
    const warnings: (Error | string)[] = []
    let lastMap: any
    const mod = await import('../resolve-paths-loader')
    const loader = (mod as any).default || (mod as any)
    const context: any = {
      resourcePath: opts?.resourcePath || '/abs/project/src/file.ts',
      sourceMap: Boolean(opts?.sourceMap),
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
          sourceMaps: 'auto',
          mode: 'development'
        }
      },
      emitWarning: (e: any) => warnings.push(e)
    }
    loader.call(context, source)
  })
}

describe('performance behaviors', () => {
  it('pre-scan skip when no eligible patterns', async () => {
    const code = `const add = (a, b) => a + b; export default add;`
    const {code: out, map} = await runLoader(code, {sourceMap: false})
    expect(out).toBe(code)
    expect(map == null).toBe(true)
  })

  it('public folder early return', async () => {
    const code = `chrome.tabs.update({ url: '/public/a.html' })`
    const {code: out} = await runLoader(code, {
      resourcePath: '/abs/project/public/file.ts'
    })
    expect(out).toBe(code)
  })
})
