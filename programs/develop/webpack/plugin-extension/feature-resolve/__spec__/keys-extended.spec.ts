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

describe('extended key coverage', () => {
  it('default_icon object map rewrites nested public paths', async () => {
    const code = `chrome.contextMenus.create({ default_icon: { 16: '/public/i16.png', 32: '/public/i32.png' } })`
    const {code: out} = await runLoader(code)
    const n = normalize(out)
    expect(n).toContain("{16:'i16.png',32:'i32.png'}")
  })

  it('default_popup rewrites pages path', async () => {
    const code = `chrome.runtime.sendMessage({ default_popup: 'pages/popup.html' })`
    const {code: out} = await runLoader(code)
    const n = normalize(out)
    expect(n).toContain("{default_popup:'pages/popup.html'}")
  })

  it('default_panel rewrites pages path', async () => {
    const code = `chrome.runtime.sendMessage({ default_panel: 'pages/panel.html' })`
    const {code: out} = await runLoader(code)
    const n = normalize(out)
    expect(n).toContain("{default_panel:'pages/panel.html'}")
  })

  it('NewExpression with nested sizes for SetIcon', async () => {
    const code = `new chrome.declarativeContent.SetIcon({ path: { 16: '/public/i16.png', 32: '/public/i32.png' } })`
    const {code: out} = await runLoader(code)
    const n = normalize(out)
    expect(n).toContain("{16:'i16.png',32:'i32.png'}")
  })
})

