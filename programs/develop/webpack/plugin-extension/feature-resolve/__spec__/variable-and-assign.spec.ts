import {describe, it, expect} from 'vitest'

const normalize = (s: string) => s.replace(/\s+/g, '').replace(/\"/g, "'")

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
      resourcePath: opts?.resourcePath || '/abs/project/src/file.ts',
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

describe('variable and assignment flows', () => {
  it('rewrites object initializer used later', async () => {
    const code = `
      const opts = { url: '/public/a.html' }
      await chrome.tabs.create(opts)
    `
    const {code: out} = await runLoader(code)
    expect(normalize(out)).toContain("{url:'a.html'}")
  })

  it('rewrites assignment object used later', async () => {
    const code = `
      let opts
      opts = { url: '/public/a.html' }
      await chrome.tabs.create(opts)
    `
    const {code: out} = await runLoader(code)
    expect(normalize(out)).toContain("{url:'a.html'}")
  })
})
