import {describe, it, expect} from 'vitest'

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

describe('diagnostics (MESSAGE-GUIDE)', () => {
  it('emits unresolved nested src pages/scripts warning', async () => {
    const code = `chrome.tabs.update({ url: 'src/pages/welcome.html' })`
    const {warnings} = await runLoader(code)
    // Should include NOT FOUND absolute path line
    const body = String(warnings[0] || '')
    expect(body).toContain('Check the path used in your extension API call.')
    expect(body).toContain('NOT FOUND /abs/project/src/pages/welcome.html')
  })

  it('emits missing public asset warning once (dedup)', async () => {
    const code = `
      chrome.runtime.getURL('/public/__definitely_missing__.png')
      chrome.runtime.getURL('/public/__definitely_missing__.png')
    `
    const {warnings} = await runLoader(code)
    expect(warnings.length >= 1).toBe(true)
    // Should only be one unique message per file
    expect(warnings.length).toBe(1)
    const body = String(warnings[0] || '')
    expect(body).toContain('Check the path used in your extension API call.')
    expect(body).toContain("Paths starting with '/' are resolved")
    expect(body).toContain('NOT FOUND')
  })
})

