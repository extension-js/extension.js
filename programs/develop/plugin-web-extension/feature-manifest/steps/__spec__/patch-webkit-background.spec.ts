import {describe, expect, it} from 'vitest'
import type {Manifest} from '../../../../types'
import {patchWebkitBackground} from '../patch-webkit-background'

const worker = {
  manifest_version: 3,
  name: 'x',
  version: '1.0.0',
  background: {service_worker: 'background/service_worker.js'}
} as unknown as Manifest

describe('patchWebkitBackground', () => {
  it('turns a Safari service worker into a non-persistent background page', () => {
    expect(patchWebkitBackground(worker, 'safari').background).toEqual({
      scripts: ['background/service_worker.js'],
      persistent: false
    })
  })

  it('drops the worker-only type key and keeps the rest', () => {
    const typed = {
      ...worker,
      background: {
        service_worker: 'background/service_worker.js',
        type: 'module',
        extra: 1
      }
    } as unknown as Manifest

    expect(patchWebkitBackground(typed, 'safari').background).toEqual({
      scripts: ['background/service_worker.js'],
      persistent: false,
      extra: 1
    })
  })

  it('leaves every other browser alone', () => {
    for (const browser of ['chrome', 'edge', 'firefox', 'waterfox'] as const) {
      expect(patchWebkitBackground(worker, browser)).toBe(worker)
    }
  })

  it('is a no-op when the manifest already declares scripts or no background', () => {
    const scripts = {
      ...worker,
      background: {scripts: ['background.js']}
    } as unknown as Manifest
    const none = {manifest_version: 3, name: 'x'} as unknown as Manifest

    expect(patchWebkitBackground(scripts, 'safari')).toBe(scripts)
    expect(patchWebkitBackground(none, 'safari')).toBe(none)
  })
})
