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
            path.join(process.cwd(), 'extensions/browser-extension/manifest.json'),
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

describe('feature-resolve: JSX stability (Preact)', () => {
  it('preserves JSX and handles browser.runtime.getURL', async () => {
    const src = `
      import {h} from 'preact'
      const Icon = () => <i class="i">i</i>
      export const View = () => (
        <section>
          <Icon />
          <img src={browser.runtime.getURL('icons/i.png')} />
        </section>
      )
    `
    const {code} = await runLoader(
      src,
      path.join(process.cwd(), 'src/view.jsx')
    )
    expect(code).toMatch('<Icon />')
    expect(code).toMatch('<img src={')
    expect(code).toMatch('<section>')
  })
})


