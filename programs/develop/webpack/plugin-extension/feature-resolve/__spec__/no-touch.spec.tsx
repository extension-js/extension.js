import {describe, it, expect} from 'vitest'
import path from 'path'
import loader from '../resolve-paths-loader'

function runLoader(source: string, resourcePath: string) {
  return new Promise<{code: string; map?: any}>((resolve, reject) => {
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

describe('feature-resolve: no-op on files without patterns', () => {
  it('returns identical source for TSX without extension API patterns', async () => {
    const src = `
      import React from 'react'
      const A = () => <div className="a"><span /></div>
      export default A
    `
    const {code, map} = await runLoader(
      src,
      path.join(process.cwd(), 'src/A.tsx')
    )
    expect(code).toEqual(src)
    expect(map).toBeUndefined()
  })
})

