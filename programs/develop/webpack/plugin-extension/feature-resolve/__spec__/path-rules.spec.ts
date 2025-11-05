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

describe('path rules matrix', () => {
  it('public-root variants to bare names', async () => {
    const code = `
      chrome.runtime.getURL('/public/x.png')
      chrome.runtime.getURL('public/y.png')
      chrome.runtime.getURL('/z.png')
    `
    const {code: out} = await runLoader(code)
    const n = normalize(out)
    expect(n).toContain("getURL('x.png')")
    expect(n).toContain("getURL('y.png')")
    expect(n).toContain("getURL('z.png')")
  })

  it('pages and scripts normalization from package root', async () => {
    const code = `
      chrome.tabs.update({ url: 'pages/welcome.html' })
      chrome.scripting.executeScript({ files: ['scripts/a.tsx'] })
      chrome.scripting.executeScript({ files: ['./scripts/b.ts'] })
      chrome.tabs.update({ url: './pages/welcome.njk' })
    `
    const {code: out} = await runLoader(code)
    const n = normalize(out)
    expect(n).toContain("{url:'pages/welcome.html'}")
    expect(n).toContain("{files:['scripts/a.js']}")
    expect(n).toContain("{files:['scripts/b.js']}")
    expect(n).toContain("{url:'pages/welcome.html'}")
  })
})
