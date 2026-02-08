import {describe, it, expect} from 'vitest'
import path from 'path'
import loader from '../resolve-paths-loader'

function runLoader(
  source: string,
  resourcePath: string,
  opts?: Partial<{
    manifestPath: string
    packageJsonDir?: string
    outputPath?: string
  }>
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
          manifestPath:
            opts?.manifestPath ??
            path.join(
              process.cwd(),
              'extensions/browser-extension/manifest.json'
            ),
          packageJsonDir:
            opts?.packageJsonDir ??
            path.join(process.cwd(), 'extensions/browser-extension'),
          outputPath:
            opts?.outputPath ??
            path.join(process.cwd(), 'extensions/browser-extension/dist')
        }
      },
      resourcePath,
      sourceMap: true
    }
    // @ts-expect-error loader context typing
    loader.call(ctx, source)
  })
}

describe('feature-resolve: TypeScript literal rewrites + sourcemaps', () => {
  it('rewrites chrome paths in TS and emits sourcemap when edited', async () => {
    const src = `
      export function getUrl() {
        const a = chrome.runtime.getURL('icons/icon-128.png')
        const b = browser.runtime.getURL('icons/icon-16.png')
        return [a, b]
      }
    `
    const {code, map} = await runLoader(
      src,
      path.join(process.cwd(), 'src/util.ts')
    )
    expect(code).toMatch(/chrome\.runtime\.getURL\s*\(/)
    expect(code).toMatch(/browser\.runtime\.getURL\s*\(/)
    expect(map).toBeTruthy()
  })
})
