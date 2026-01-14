import {describe, it, expect} from 'vitest'

const normalize = (s: string) => s.replace(/\"/g, "'").replace(/\s+/g, '')

async function runLoader(
  source: string,
  opts?: Partial<{
    manifestPath: string
    includeList: Record<string, string | string[] | undefined>
    resourcePath: string
    strict: boolean
  }>
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
          includeList: opts?.includeList || {},
          strict: Boolean(opts?.strict),
          mode: 'development'
        }
      },
      emitWarning: (e: any) => warnings.push(e)
    }
    loader.call(context, source)
  })
}

describe('resolve-paths-loader stress', () => {
  const hasSwc = (() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('@swc/core')
      return true
    } catch {
      return false
    }
  })()

  it('does not corrupt adjacent properties in tabs.create object', async () => {
    const code = `
      async function x(){
        await browser.tabs.create({url: 'pages/welcome.html', active: true})
      }
    `
    const {code: out} = await runLoader(code)
    if (hasSwc) {
      const norm = normalize(out)
      expect(norm).toContain("{url:'pages/welcome.html',active:true}")
    } else {
      expect(out).toContain("{url: 'pages/welcome.html', active: true}")
    }
  })

  it('handles escaped quotes inside literals without spilling over', async () => {
    const code = `
      const a = chrome.runtime.getURL("/public/a\\\"b.png")
    `
    const {code: out} = await runLoader(code)
    if (hasSwc) {
      const ws = out.replace(/\s+/g, '')
      expect(ws).toMatch(/getURL\((?:'a"b\.png'|"a\\"b\.png")\)/)
    } else {
      expect(out).toContain('getURL("/public/a\\"b.png")')
    }
  })

  it('does not remove commas or introduce syntax errors after rewrite', async () => {
    const code = `
      async function y(){
        const opts = { url: '/public/a.html', active: true }
        await chrome.windows.create(opts)
      }
    `
    const {code: out} = await runLoader(code)
    if (hasSwc) {
      const norm = normalize(out)
      expect(norm).toContain("{url:'a.html',active:true}")
    } else {
      expect(out).toContain("{ url: '/public/a.html', active: true }")
    }
  })

  it('rewrites within arrays without impacting neighbors', async () => {
    const code = `
      chrome.windows.create({ url: ['/public/a.html', '/public/b.html', 'pages/welcome.html'] })
    `
    const {code: out} = await runLoader(code)
    if (hasSwc) {
      const norm = normalize(out)
      expect(norm).toContain("{url:['a.html','b.html','pages/welcome.html']}")
    } else {
      expect(out).toContain(
        "{ url: ['/public/a.html', '/public/b.html', 'pages/welcome.html'] }"
      )
    }
  })

  it('maps ./pages to pages for url keys (generic handler)', async () => {
    const code = `browser.tabs.create({ url: './pages/welcome.html' })`
    const {code: out} = await runLoader(code)
    if (hasSwc) {
      const norm = normalize(out)
      expect(norm).toContain("{url:'pages/welcome.html'}")
    } else {
      expect(out).toContain("{ url: './pages/welcome.html' }")
    }
  })

  it('supports static concatenations in object url via generic handler', async () => {
    const code = `chrome.tabs.create({ url: '/public/' + 'a.html' })`
    const {code: out} = await runLoader(code)
    if (hasSwc) {
      const norm = normalize(out)
      expect(norm).toContain("{url:'a.html'}")
    } else {
      expect(out).toContain("{ url: '/public/' + 'a.html' }")
    }
  })

  it('emits warning when missing public file', async () => {
    const code = `chrome.runtime.getURL('/public/__definitely_missing__.png')`
    const {warnings} = await runLoader(code, {
      manifestPath: '/abs/project/manifest.json'
    })
    // We cannot assert exact message, but should have at least one warning
    if (hasSwc) {
      expect(warnings.length >= 1).toBe(true)
    }
  })

  it('does not rewrite non-path fields (e.g., storage payloads)', async () => {
    const code = `chrome.storage.local.set({ key: '/public/a.html' })`
    const {code: out} = await runLoader(code)
    const norm = normalize(out)
    expect(norm).toContain("chrome.storage.local.set({key:'/public/a.html'})")
  })

  it('does not rewrite http/data/chrome/moz-extension URLs', async () => {
    const code = `
      chrome.windows.create({ url: 'https://example.com/page' })
      chrome.tabs.update({ url: 'data:text/plain,hello' })
      browser.tabs.create({ url: 'chrome://extensions' })
      browser.tabs.create({ url: 'moz-extension://abcd/foo.html' })
    `
    const {code: out} = await runLoader(code)
    const norm = normalize(out)
    expect(norm).toContain("{url:'https://example.com/page'}")
    expect(norm).toContain("{url:'data:text/plain,hello'}")
    expect(norm).toContain("{url:'chrome://extensions'}")
    expect(norm).toContain("{url:'moz-extension://abcd/foo.html'}")
  })

  it('warns on nested pages/scripts when unresolved', async () => {
    const code = `chrome.tabs.create({ url: 'src/pages/welcome.html' })`
    const {warnings} = await runLoader(code)
    if (hasSwc) {
      expect(warnings.length >= 1).toBe(true)
    }
  })
})

