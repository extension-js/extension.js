import {describe, expect, it} from 'vitest'
import {scannableSourcePath} from '../scannable-source-path'

describe('scannableSourcePath', () => {
  it('reads every script extension, .mts and .cts included', () => {
    for (const ext of ['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'mts', 'cts']) {
      expect(scannableSourcePath(`/p/src/a.${ext}`), ext).toBe(
        `/p/src/a.${ext}`
      )
    }
  })

  it('drops a request query before the extension test and the read', () => {
    expect(scannableSourcePath('/p/src/a.ts?used')).toBe('/p/src/a.ts')
    expect(scannableSourcePath('/p/App.vue?vue&type=script&lang.ts')).toBe(
      '/p/App.vue'
    )

    expect(scannableSourcePath('/p/App.svelte')).toBe('/p/App.svelte')
  })

  it('skips dependencies, data files and empty resources', () => {
    expect(scannableSourcePath('/p/node_modules/x/a.js')).toBeUndefined()
    expect(scannableSourcePath('/p/data.json')).toBeUndefined()
    expect(scannableSourcePath('/p/style.css?x.ts')).toBeUndefined()
    expect(scannableSourcePath(undefined)).toBeUndefined()
  })
})
