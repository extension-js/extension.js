import {describe, it, expect} from 'vitest'
import path from 'path'
import loader from '../resolve-paths-loader'

function runLoader(source, resourcePath, opts) {
  return new Promise((resolve, reject) => {
    const ctx = {
      async() {
        return (err, code, map) => {
          if (err) return reject(err)
          resolve({code: String(code ?? ''), map})
        }
      },
      cacheable() {},
      emitWarning() {},
      getOptions() {
        return {
          manifestPath:
            (opts && opts.manifestPath) ||
            path.join(
              process.cwd(),
              'extensions/browser-extension/manifest.json'
            ),
          packageJsonDir:
            (opts && opts.packageJsonDir) ||
            path.join(process.cwd(), 'extensions/browser-extension'),
          outputPath:
            (opts && opts.outputPath) ||
            path.join(process.cwd(), 'extensions/browser-extension/dist')
        }
      },
      resourcePath,
      sourceMap: true
    }
    loader.call(ctx, source)
  })
}

describe('feature-resolve: JavaScript literal rewrites + sourcemaps', () => {
  it('rewrites chrome paths in JS and emits sourcemap when edited', async () => {
    const src = `
      export function getUrl() {
        const p = chrome.runtime.getURL('icons/icon-48.png')
        return p
      }
    `
    const {code, map} = await runLoader(
      src,
      path.join(process.cwd(), 'src/util.js')
    )
    expect(code).toMatch(/chrome\.runtime\.getURL\s*\(/)
    expect(map).toBeTruthy()
  })
})
