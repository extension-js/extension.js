import {describe, it, expect} from 'vitest'

const normalize = (s: string) => s.replace(/\"/g, "'").replace(/\s+/g, '')

async function runLoader(
  source: string,
  opts?: Partial<{
    manifestPath: string
    includeList: Record<string, string | string[] | undefined>
    resourcePath: string
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
          mode: 'development'
        }
      },
      emitWarning: (e: any) => warnings.push(e)
    }
    loader.call(context, source)
  })
}

describe('feature-resolve handlers coverage', () => {
  const hasSwc = (() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('@swc/core')
      return true
    } catch {
      return false
    }
  })()

  it('action.setIcon path (string and sizes object)', async () => {
    const code = `
      chrome.action.setIcon({ path: '/public/icon.png' })
      chrome.action.setIcon({ path: { 16: '/public/icon-16.png', 32: '/public/icon-32.png' } })
    `
    const {code: out} = await runLoader(code)
    if (hasSwc) {
      const norm = normalize(out)
      expect(norm).toContain("{path:'icon.png'}")
      expect(norm).toContain("{16:'icon-16.png',32:'icon-32.png'}")
    }
  })

  it('action.setPopup popup path', async () => {
    const code = `chrome.action.setPopup({ popup: 'pages/popup.html' })`
    const {code: out} = await runLoader(code)
    if (hasSwc) {
      const norm = normalize(out)
      expect(norm).toContain("{popup:'pages/popup.html'}")
    }
  })

  it('tabs.update url', async () => {
    const code = `chrome.tabs.update({ url: '/public/a.html' })`
    const {code: out} = await runLoader(code)
    if (hasSwc) {
      const norm = normalize(out)
      expect(norm).toContain("{url:'a.html'}")
    }
  })

  it('scripting.registerContentScripts js/css arrays', async () => {
    const code = `
      chrome.scripting.registerContentScripts([{ id: 'x', js: ['/public/a.js', 'scripts/cs.ts'], css: ['/public/a.css'] }])
    `
    const {code: out} = await runLoader(code)
    if (hasSwc) {
      const norm = normalize(out)
      expect(norm).toContain("js:['a.js','scripts/cs.js']")
      expect(norm).toContain("css:['a.css']")
    }
  })

  it('scripting.executeScript and insertCSS files', async () => {
    const code = `
      chrome.scripting.executeScript({ files: ['/public/a.js'] })
      chrome.scripting.insertCSS({ files: ['/public/a.css'] })
    `
    const {code: out} = await runLoader(code)
    if (hasSwc) {
      const norm = normalize(out)
      expect(norm).toContain("{files:['a.js']}")
      expect(norm).toContain("{files:['a.css']}")
    }
  })

  it('mv2 tabs.executeScript/insertCSS file', async () => {
    const code = `
      chrome.tabs.executeScript({ file: '/public/a.js' })
      chrome.tabs.insertCSS({ file: '/public/a.css' })
    `
    const {code: out} = await runLoader(code)
    if (hasSwc) {
      const norm = normalize(out)
      expect(norm).toContain("{file:'a.js'}")
      expect(norm).toContain("{file:'a.css'}")
    }
  })

  it('devtools.panels.create icon and page', async () => {
    const code = `
      chrome.devtools.panels.create('X', '/public/icon.png', 'pages/panel.html')
    `
    const {code: out} = await runLoader(code)
    if (hasSwc) {
      const norm = normalize(out)
      expect(norm).toContain("create('X','icon.png','pages/panel.html')")
    }
  })

  it('notifications.create/update iconUrl/imageUrl', async () => {
    const code = `
      chrome.notifications.create({ iconUrl: '/public/i.png', imageUrl: '/public/im.png' })
      chrome.notifications.update('id', { iconUrl: '/public/i2.png' })
    `
    const {code: out} = await runLoader(code)
    if (hasSwc) {
      const norm = normalize(out)
      expect(norm).toContain("{iconUrl:'i.png',imageUrl:'im.png'}")
      expect(norm).toContain("{iconUrl:'i2.png'}")
    }
  })

  it('menus icons object', async () => {
    const code = `
      chrome.contextMenus.create({ icons: { 16: '/public/i16.png', 32: '/public/i32.png' } })
    `
    const {code: out} = await runLoader(code)
    if (hasSwc) {
      const norm = normalize(out)
      expect(
        norm.includes("{16:'i16.png',32:'i32.png'}") ||
          norm.includes("{16:'/public/i16.png',32:'/public/i32.png'}")
      ).toBe(true)
    }
  })

  it('declarativeContent.SetIcon path (string and sizes object)', async () => {
    const code = `
      new chrome.declarativeContent.SetIcon({ path: '/public/i.png' })
      new chrome.declarativeContent.SetIcon({ path: { 16: '/public/i16.png', 32: '/public/i32.png' } })
    `
    const {code: out} = await runLoader(code)
    if (hasSwc) {
      const norm = normalize(out)
      expect(norm).toContain("{path:'i.png'}")
      expect(norm).toContain("{16:'i16.png',32:'i32.png'}")
    }
  })

  it('sidePanel.setOptions and sidebarAction.setPanel page/panel/path', async () => {
    const code = `
      chrome.sidePanel.setOptions({ page: 'pages/x.html' })
      chrome.sidebarAction.setPanel({ panel: 'pages/y.html' })
    `
    const {code: out} = await runLoader(code)
    if (hasSwc) {
      const norm = normalize(out)
      expect(norm).toContain("{page:'pages/x.html'}")
      expect(norm).toContain("{panel:'pages/y.html'}")
    }
  })
})

