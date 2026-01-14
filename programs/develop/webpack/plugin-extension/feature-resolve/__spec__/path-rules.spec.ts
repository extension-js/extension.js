import {describe, it, expect} from 'vitest'

const normalize = (s: string) => s.replace(/\s+/g, '').replace(/\"/g, "'")

async function runLoader(
  source: string,
  opts?: Partial<{
    manifestPath: string
    resourcePath: string
    packageJsonDir: string
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
          packageJsonDir: opts?.packageJsonDir,
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

  it('normalizes /scripts and /pages with extension mapping', async () => {
    const code = `
      chrome.scripting.executeScript({ files: ['/scripts/a.ts', '/scripts/b.tsx'] })
      chrome.tabs.update({ url: '/pages/welcome.njk' })
    `
    const {code: out} = await runLoader(code)
    const n = normalize(out)
    expect(n).toContain("{files:['scripts/a.js','scripts/b.js']}")
    expect(n).toContain("{url:'pages/welcome.html'}")
  })

  it('handles ../public after normalization like public/', async () => {
    const code = `
      chrome.runtime.getURL('../public/img/logo.png')
      chrome.scripting.executeScript({ files: ['../public/a.js'] })
    `
    const {code: out} = await runLoader(code, {
      manifestPath: '/abs/project/manifest.json',
      resourcePath: '/abs/project/src/background.ts'
    })
    const n = normalize(out)
    expect(n).toContain("getURL('img/logo.png')")
    expect(n).toContain("{files:['a.js']}")
  })

  it('treats ./pages and ./scripts from project root identically to pages/scripts', async () => {
    const code = `
      chrome.tabs.create({ url: './pages/popup.html' })
      chrome.scripting.insertCSS({ files: ['./scripts/style.scss'] })
    `
    const {code: out} = await runLoader(code)
    const n = normalize(out)
    expect(n).toContain("{url:'pages/popup.html'}")
    expect(n).toContain("{files:['scripts/style.css']}")
  })

  it('normalizes parent-relative ../scripts from a src file (manifest at project root)', async () => {
    const code = `
      chrome.scripting.executeScript({ files: ['../scripts/a.ts'] })
    `
    const {code: out} = await runLoader(code, {
      manifestPath: '/abs/project/manifest.json',
      resourcePath: '/abs/project/src/background.ts'
    })
    const n = normalize(out)
    expect(n).toContain("{files:['scripts/a.js']}")
  })

  it('normalizes parent-relative ../scripts with manifest under src when packageJsonDir provided', async () => {
    const code = `
      chrome.scripting.executeScript({ files: ['../scripts/a.ts'] })
    `
    const {code: out} = await runLoader(code, {
      manifestPath: '/abs/project/src/manifest.json',
      packageJsonDir: '/abs/project',
      resourcePath: '/abs/project/src/background.ts'
    })
    const n = normalize(out)
    expect(n).toContain("{files:['scripts/a.js']}")
  })
})

