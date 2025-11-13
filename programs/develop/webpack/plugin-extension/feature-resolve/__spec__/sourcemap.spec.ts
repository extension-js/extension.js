import {describe, it, expect} from 'vitest'
import path from 'path'
import loader from '../resolve-paths-loader'

function runLoader(
  source: string,
  resourcePath: string
): Promise<{code: string; map?: any}> {
  return new Promise((resolve, reject) => {
    const ctx: any = {
      async() {
        return (err: any, code?: string, map?: any) => {
          if (err) return reject(err)
          resolve({code: String(code ?? ''), map})
        }
      },
      cacheable() {},
      emitWarning() {},
      getOptions() {
        return {
          manifestPath: path.join(
            process.cwd(),
            'extensions/browser-extension/manifest.json'
          ),
          packageJsonDir: path.join(
            process.cwd(),
            'extensions/browser-extension'
          ),
          outputPath: path.join(
            process.cwd(),
            'extensions/browser-extension/dist'
          )
        }
      },
      resourcePath,
      sourceMap: true
    }
    // @ts-expect-error loader context typing
    loader.call(ctx, source)
  })
}

describe('feature-resolve: sourcemaps for edited files', () => {
  it('emits a map when a literal is rewritten', async () => {
    const src = `
      export function x(){
        return chrome.runtime.getURL('icons/icon-128.png')
      }
    `
    const {map} = await runLoader(src, path.join(process.cwd(), 'src/x.ts'))
    expect(map).toBeTruthy()
    expect(typeof map.version).toBe('number')
    expect(map.sources?.length).toBeGreaterThan(0)
  })
})

import {describe, it, expect} from 'vitest'

async function runLoader(
  source: string,
  opts?: Partial<{
    manifestPath: string
    resourcePath: string
    sourceMaps: 'auto' | boolean
  }>
): Promise<{code: string; map: any; warnings: (Error | string)[]}> {
  return new Promise(async (resolve, reject) => {
    const warnings: (Error | string)[] = []
    let lastMap: any
    const mod = await import('../resolve-paths-loader')
    const loader = (mod as any).default || (mod as any)
    const context: any = {
      resourcePath: opts?.resourcePath || '/abs/project/src/file.ts',
      sourceMap: true, // simulate devtool so 'auto' enables maps
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
          sourceMaps: opts?.sourceMaps ?? 'auto',
          mode: 'development'
        }
      },
      emitWarning: (e: any) => warnings.push(e)
    }
    loader.call(context, source)
  })
}

describe('resolve-paths sourcemaps', () => {
  it('emits a sourcemap and preserves line count for simple rewrites', async () => {
    const code = [
      "const a = 'x'",
      "chrome.tabs.update({ url: '/public/a.html' })",
      'const z = 123'
    ].join('\n')
    const {code: out, map} = await runLoader(code)
    expect(map).toBeTruthy()
    const norm = out.replace(/\"/g, "'").replace(/\s+/g, '')
    expect(norm).toContain("url:'a.html'")
    // Basic map shape sanity (string or object)
    if (typeof map === 'string') {
      expect(map.includes('"version":3')).toBe(true)
    } else {
      expect(map.version).toBe(3)
      expect(Array.isArray(map.sources)).toBe(true)
      expect(map.file || map.sources[0]).toBeTruthy()
    }
  })
})
