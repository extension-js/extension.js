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

describe('ignored / non-resolvable cases', () => {
  it('keeps dynamic template expressions unchanged', async () => {
    const code = 'chrome.tabs.update({ url: `/public/${name}.html` })'
    const {code: out} = await runLoader(code)
    expect(out).toContain('${name}')
  })

  it('ignores glob patterns in files', async () => {
    const code = "chrome.scripting.executeScript({ files: ['pages/*.js'] })"
    const {code: out} = await runLoader(code)
    const n = normalize(out)
    expect(n).toContain("['pages/*.js']")
  })

  it('does not rewrite http/data/chrome/moz-extension URLs', async () => {
    const code = `
      chrome.windows.create({ url: 'https://example.com/page' })
      chrome.tabs.update({ url: 'data:text/plain,hello' })
      browser.tabs.create({ url: 'chrome://extensions' })
      browser.tabs.create({ url: 'moz-extension://abcd/foo.html' })
    `
    const {code: out} = await runLoader(code)
    const n = normalize(out)
    expect(n).toContain("{url:'https://example.com/page'}")
    expect(n).toContain("{url:'data:text/plain,hello'}")
    expect(n).toContain("{url:'chrome://extensions'}")
    expect(n).toContain("{url:'moz-extension://abcd/foo.html'}")
  })
})

