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

describe('feature-resolve: Vue compiled JS stability', () => {
  it('rewrites literals in render without altering structure', async () => {
    // Simulated Vue SFC-compiled render using chrome.runtime.getURL literal
    const src = `
      export function render(_ctx, _cache) {
        return (_openBlock(), _createElementBlock(\"img\", {
          alt: \"x\",
          src: chrome.runtime.getURL('icons/icon-32.png')
        }))
      }
    `
    const {code} = await runLoader(
      src,
      path.join(process.cwd(), 'src/App.vue.js')
    )
    expect(code).toMatch('export function render')
    expect(code).toMatch('_createElementBlock')
    expect(code).toMatch(/chrome\.runtime\.getURL\s*\(/)
  })
})
