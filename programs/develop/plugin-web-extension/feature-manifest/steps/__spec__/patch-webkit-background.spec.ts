import {describe, expect, it} from 'vitest'
import type {Manifest} from '../../../../types'
import {patchWebkitBackground} from '../patch-webkit-background'

const worker = {
  manifest_version: 3,
  name: 'x',
  version: '1.0.0',
  background: {service_worker: 'background/service_worker.js'}
} as unknown as Manifest

function withBackground(background: Record<string, unknown>): Manifest {
  return {...worker, background} as unknown as Manifest
}

describe('patchWebkitBackground', () => {
  // No `persistent` key on purpose: Manifest V3 background scripts are already
  // non-persistent, and Safari's converter reports the key as unsupported.
  it('turns a Safari service worker into a background page', () => {
    expect(patchWebkitBackground(worker, 'safari').background).toEqual({
      scripts: ['background/service_worker.js']
    })
  })

  it('drops the worker-only type key and keeps the rest', () => {
    const typed = withBackground({
      service_worker: 'background/service_worker.js',
      type: 'module',
      extra: 1
    })

    expect(patchWebkitBackground(typed, 'safari').background).toEqual({
      scripts: ['background/service_worker.js'],
      extra: 1
    })
  })

  it('drops persistent while converting a service worker', () => {
    const persistent = withBackground({
      service_worker: 'background/service_worker.js',
      persistent: false
    })

    expect(patchWebkitBackground(persistent, 'safari').background).toEqual({
      scripts: ['background/service_worker.js']
    })
  })

  // Safari 27's converter rejects `persistent` whatever its value, and a
  // manifest already in scripts form used to keep it (ledger 1042).
  it('drops persistent from a background already in scripts form', () => {
    for (const value of [true, false]) {
      const scripts = withBackground({
        scripts: ['background.js'],
        persistent: value,
        extra: 1
      })

      expect(patchWebkitBackground(scripts, 'safari').background).toEqual({
        scripts: ['background.js'],
        extra: 1
      })
    }
  })

  it('drops persistent when both forms are declared', () => {
    const both = withBackground({
      service_worker: 'background/service_worker.js',
      scripts: ['background.js'],
      persistent: true
    })

    expect(patchWebkitBackground(both, 'safari').background).toEqual({
      service_worker: 'background/service_worker.js',
      scripts: ['background.js']
    })
  })

  it('leaves every other browser alone', () => {
    const persistent = withBackground({
      scripts: ['background.js'],
      persistent: true
    })

    for (const browser of ['chrome', 'edge', 'firefox', 'waterfox'] as const) {
      expect(patchWebkitBackground(worker, browser)).toBe(worker)
      expect(patchWebkitBackground(persistent, browser)).toBe(persistent)
    }
  })

  it('is a no-op when the manifest already declares scripts or no background', () => {
    const scripts = withBackground({scripts: ['background.js']})
    const none = {manifest_version: 3, name: 'x'} as unknown as Manifest

    expect(patchWebkitBackground(scripts, 'safari')).toBe(scripts)
    expect(patchWebkitBackground(none, 'safari')).toBe(none)
  })
})
