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

describe('feature-resolve: JSX stability (React)', () => {
  it('preserves JSX structure while handling chrome.runtime.getURL', async () => {
    const src = `
      import React from 'react'
      const Logo = () => <span role="img" aria-label="l">🔧</span>
      export function Component() {
        const url = chrome.runtime.getURL('icons/icon-128.png')
        return (
          <div className="wrap">
            <Logo />
            <img alt="x" src={chrome.runtime.getURL('icons/icon-16.png')} />
          </div>
        )
      }
    `
    const {code} = await runLoader(
      src,
      path.join(process.cwd(), 'src/components/Example.tsx')
    )
    // Key JSX markers remain intact
    expect(code).toMatch('<Logo />')
    expect(code).toMatch('<img alt="x"')
    expect(code).toMatch('className="wrap"')
    // API call still present (literal may be normalized but call remains)
    expect(code).toMatch(/chrome\.runtime\.getURL\s*\(/)
  })
})
