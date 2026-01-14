import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'

async function runLoader(
  source: string,
  opts?: Partial<{
    manifestPath: string
    includeList: Record<string, string | string[] | undefined>
    resourcePath: string
    strict: boolean
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

describe('resolve-paths-loader', () => {
  const hasSwc = (() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('@swc/core')
      return true
    } catch {
      return false
    }
  })()

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('rewrites runtime.getURL with public-root path', async () => {
    const code = `chrome.runtime.getURL('/public/img/logo.png')`
    const {code: out} = await runLoader(code)
    if (hasSwc) {
      // Accept either single or double quotes from SWC transform
      expect(out).toMatch(/chrome\.runtime\.getURL\((['"])img\/logo\.png\1\)/)
    } else {
      expect(out).toContain("chrome.runtime.getURL('/public/img/logo.png')")
    }
  })
})

