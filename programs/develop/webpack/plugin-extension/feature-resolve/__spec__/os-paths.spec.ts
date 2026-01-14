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

describe('OS path and filename edge cases', () => {
  it('normalizes backslash paths to unix style for pages', async () => {
    const code = "chrome.tabs.create({ url: 'pages\\\\welcome.html' })"
    const {code: out} = await runLoader(code)
    expect(normalize(out)).toContain("{url:'pages/welcome.html'}")
  })

  it('handles unicode and spaces in public-root filenames', async () => {
    const code = "chrome.runtime.getURL('/public/Imáge 1.png')"
    const {code: out} = await runLoader(code)
    expect(normalize(out)).toContain("getURL('Imáge1.png')")
  })
})
