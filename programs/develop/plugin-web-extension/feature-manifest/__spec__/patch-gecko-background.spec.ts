import {describe, expect, it} from 'vitest'
import type {Manifest} from '../../../types'
import {
  hasEmptyGeckoBackgroundScripts,
  patchGeckoBackground,
  translatesGeckoServiceWorker
} from '../steps/patch-gecko-background'

const sw = (extra: Record<string, unknown> = {}): Manifest =>
  ({
    manifest_version: 3,
    name: 'x',
    version: '1',
    background: {service_worker: 'background/service_worker.js', ...extra}
  }) as unknown as Manifest

describe('patchGeckoBackground', () => {
  it('drops an empty background.scripts for Firefox, and the key with it', () => {
    const m = {
      manifest_version: 3,
      name: 'x',
      version: '1',
      background: {scripts: [], persistent: false}
    } as unknown as Manifest

    expect(hasEmptyGeckoBackgroundScripts(m, 'firefox')).toBe(true)

    const out = patchGeckoBackground(m, 'firefox')

    expect('background' in out).toBe(false)
    expect(out.name).toBe('x')
  })

  it('keeps a background page declared beside an empty scripts list', () => {
    const m = {
      manifest_version: 2,
      name: 'x',
      version: '1',
      background: {scripts: [], page: 'background/index.html'}
    } as unknown as Manifest

    expect(patchGeckoBackground(m, 'firefox').background).toEqual({
      page: 'background/index.html'
    })
  })

  it('still translates a service worker declared beside an empty scripts list', () => {
    const out = patchGeckoBackground(sw({scripts: []}), 'firefox')

    expect(out.background).toEqual({scripts: ['background/service_worker.js']})
  })

  it('reads an empty scripts list as a Firefox case only', () => {
    const m = {
      manifest_version: 3,
      name: 'x',
      version: '1',
      background: {scripts: []}
    } as unknown as Manifest

    expect(hasEmptyGeckoBackgroundScripts(m, 'chrome')).toBe(false)
    expect(hasEmptyGeckoBackgroundScripts(m, 'safari')).toBe(false)
    expect(patchGeckoBackground(m, 'chrome')).toBe(m)
    expect(hasEmptyGeckoBackgroundScripts(sw(), 'firefox')).toBe(false)
    expect(
      hasEmptyGeckoBackgroundScripts(
        sw({scripts: ['background/scripts.js']}),
        'firefox'
      )
    ).toBe(false)
  })

  it('translates service_worker → scripts for Firefox', () => {
    const out = patchGeckoBackground(sw(), 'firefox')
    expect(out.background).toEqual({scripts: ['background/service_worker.js']})
  })

  it('translates for gecko-based targets too and drops `type`', () => {
    const out = patchGeckoBackground(sw({type: 'module'}), 'gecko-based')
    expect(out.background).toEqual({scripts: ['background/service_worker.js']})
    expect((out.background as any).service_worker).toBeUndefined()
    expect((out.background as any).type).toBeUndefined()
  })

  it('is a no-op for Chromium targets', () => {
    const m = sw()
    expect(patchGeckoBackground(m, 'chrome')).toBe(m)
    expect(patchGeckoBackground(m, 'edge')).toBe(m)
  })

  it('is a no-op when the manifest already uses background.scripts', () => {
    const m = {
      manifest_version: 3,
      name: 'x',
      version: '1',
      background: {scripts: ['background/scripts.js']}
    } as unknown as Manifest
    expect(patchGeckoBackground(m, 'firefox')).toBe(m)
  })

  it('is a no-op when there is no background', () => {
    const m = {manifest_version: 3, name: 'x', version: '1'} as Manifest
    expect(patchGeckoBackground(m, 'firefox')).toBe(m)
  })
})

describe('translatesGeckoServiceWorker', () => {
  it('is true only for a gecko service worker with no scripts list', () => {
    expect(translatesGeckoServiceWorker(sw(), 'firefox')).toBe(true)
    expect(translatesGeckoServiceWorker(sw(), 'gecko-based')).toBe(true)
    expect(translatesGeckoServiceWorker(sw(), 'chrome')).toBe(false)
    expect(
      translatesGeckoServiceWorker(sw({scripts: ['bg.js']}), 'firefox')
    ).toBe(false)

    // An empty list has its own warning, so it is not counted twice.
    expect(translatesGeckoServiceWorker(sw({scripts: []}), 'firefox')).toBe(
      false
    )
  })
})
