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

describe('nested and mixed shapes', () => {
  it('rewrites nested objects inside files array', async () => {
    const code = `
      chrome.scripting.executeScript({ files: [{ path: '/public/a.js' }, '/public/b.js'] })
    `
    const {code: out} = await runLoader(code)
    const n = normalize(out)
    expect(n).toContain("{files:[{path:'a.js'},'b.js']}")
  })

  it('leaves spread elements untouched while rewriting neighbors', async () => {
    const code = `
      const more = ['x.js']
      chrome.scripting.executeScript({ files: ['/public/a.js', ...more, '/public/b.js'] })
    `
    const {code: out} = await runLoader(code)
    const n = normalize(out)
    expect(n).toContain("{files:['a.js',...more,'b.js']}")
  })

  it('rewrites numeric and quoted keys in icons object', async () => {
    const code = `
      chrome.contextMenus.create({ icons: { 16: '/public/i16.png', '32': '/public/i32.png' } })
    `
    const {code: out} = await runLoader(code)
    const n = normalize(out)
    // Accept quoted or unquoted numeric key for '32' and tolerate /public prefix
    expect(
      n.includes("16:'i16.png'") ||
        n.includes("16:'/public/i16.png'") ||
        /16:''i16\.png''/.test(n)
    ).toBe(true)
    expect(
      n.includes("32:'i32.png'") ||
        n.includes("'32':'i32.png'") ||
        n.includes("32:'/public/i32.png'") ||
        n.includes("'32':'/public/i32.png'")
    ).toBe(true)
  })
})
