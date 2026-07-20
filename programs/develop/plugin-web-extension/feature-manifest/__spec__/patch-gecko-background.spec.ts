import {describe, expect, it} from 'vitest'
import type {Manifest} from '../../../types'
import {patchGeckoBackground} from '../steps/patch-gecko-background'

const sw = (extra: Record<string, unknown> = {}): Manifest =>
  ({
    manifest_version: 3,
    name: 'x',
    version: '1',
    background: {service_worker: 'background/service_worker.js', ...extra}
  }) as unknown as Manifest

describe('patchGeckoBackground', () => {
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
