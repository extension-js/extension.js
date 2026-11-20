import {describe, expect, it} from 'vitest'
import {BACKGROUND_ASSET} from '../background-asset'

describe('BACKGROUND_ASSET', () => {
  it('names each background file a build emits at the output root', () => {
    for (const name of [
      'background/service_worker.js',
      'background/scripts.js',
      'background/script.js',
      'background/index.js'
    ]) {
      expect(BACKGROUND_ASSET.test(name), name).toBe(true)
    }
  })

  // A deeper folder of that name, or another file in it, is the project's.
  it('names no file outside that root or of another name', () => {
    for (const name of [
      'src/background/service_worker.js',
      'background/service_worker.js.map',
      'background/helper.js',
      'content_scripts/content-0.js'
    ]) {
      expect(BACKGROUND_ASSET.test(name), name).toBe(false)
    }
  })
})
