import {describe, it, expect} from 'vitest'
import ensureHMRForScripts from '../../steps/ensure-hmr-for-scripts'

function makeLoaderCtx(options: any) {
  return {
    getOptions: () => options
  } as any
}

describe('ensureHMRForScripts loader', () => {
  it('prepends HMR accept code', () => {
    const src = 'console.log("x")'
    const out = ensureHMRForScripts.call(
      makeLoaderCtx({manifestPath: '/m'}),
      src
    )
    expect(out).toContain('import.meta.webpackHot')
    expect(out).toContain(src)
  })
})

