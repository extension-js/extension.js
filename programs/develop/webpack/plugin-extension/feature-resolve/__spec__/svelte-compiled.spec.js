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

describe('feature-resolve: Svelte compiled JS stability', () => {
  it('rewrites literals without altering compiled structure', async () => {
    // Simulated Svelte compiled output using chrome.runtime.getURL literal
    const src = `
      function create_fragment(ctx) {
        let img_1;
        return {
          c() {
            img_1 = element("img");
            img_1.src = chrome.runtime.getURL('icons/icon-48.png');
          },
          m(target, anchor) {
            insert(target, img_1, anchor);
          },
          d(detaching) {
            if (detaching) detach(img_1);
          }
        };
      }
      export default class Component {}
    `
    const {code} = await runLoader(
      src,
      path.join(process.cwd(), 'src/Component.svelte.js')
    )
    expect(code).toMatch('function create_fragment')
    expect(code).toMatch('element("img")')
    expect(code).toMatch(/chrome\.runtime\.getURL\s*\(/)
  })
})

