import {describe, it, expect} from 'vitest'

async function runLoader(
  source: string,
  opts?: Partial<{
    manifestPath: string
    resourcePath: string
    outputPath: string
  }>
): Promise<{code: string; map: any; warnings: (Error | string)[]}> {
  const warnings: (Error | string)[] = []
  let lastMap: any
  const mod = await import('../resolve-paths-loader')
  const loader = (mod as any).default || (mod as any)
  return new Promise((resolve, reject) => {
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
          outputPath: opts?.outputPath || '/abs/project/dist/chrome',
          mode: 'development'
        }
      },
      emitWarning: (e: any) => warnings.push(e)
    }
    loader.call(context, source)
  })
}

describe('resolve-paths-loader: avoid false positives', () => {
  it('does not warn for non-API usage like fetch with root path', async () => {
    const code = `
      const login = '/login'
      async function go() {
        await fetch('/login', { method: 'GET' })
      }
    `
    const {warnings} = await runLoader(code)
    expect(warnings.length).toBe(0)
  })

  it('does not warn for plain constants and JSX-like strings without extension APIs', async () => {
    const code = `
      const FAVICON = '/favicon.ico'
      const href = '/settings'
      const el = { href: '/login' }
    `
    const {warnings} = await runLoader(code)
    expect(warnings.length).toBe(0)
  })

  it('warns only for extension API contexts and includes helpful details', async () => {
    const code = `
      const IGNORE = '/favicon.ico'
      // Non-API usage
      const url = '/login'
      // API usage should be analyzed
      chrome.tabs.create({ url: '/login' })
    `
    const {warnings} = await runLoader(code)
    // Should have exactly one warning (from the API usage)
    expect(warnings.length).toBe(1)
    const msg = String((warnings[0] as any)?.message || warnings[0])
    expect(msg).toContain('Check the path used in your extension API call.')
    expect(msg).toContain(
      'The path must point to an existing file that will be packaged with the extension.'
    )
    expect(msg).toContain('Found value: /login')
    expect(msg).toContain('Resolved path:')
    expect(msg).toContain('NOT FOUND ')
  })

  it('does not duplicate identical warnings within the same file', async () => {
    const code = `
      chrome.tabs.create({ url: '/login' })
      chrome.tabs.update({ url: '/login' })
    `
    const {warnings} = await runLoader(code)
    // Same NOT FOUND display body should be de-duplicated
    expect(warnings.length).toBe(1)
  })
})

