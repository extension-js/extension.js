import {describe, expect, it} from 'vitest'
import type {Manifest} from '../../../types'
import patchBackground from '../steps/apply-dev-defaults-lib/patch-background'

describe('patchBackground dev persistence (§68)', () => {
  it('forces persistent on an MV2 event page so the control channel survives idle', () => {
    const manifest = {
      manifest_version: 2,
      background: {scripts: ['bg.js'], persistent: false}
    } as unknown as Manifest

    const patch = patchBackground(manifest, 'firefox')
    expect((patch.background as {persistent?: boolean}).persistent).toBe(true)
    expect((patch.background as {scripts?: string[]}).scripts).toEqual([
      'bg.js'
    ])
  })

  it('does not add the persistent key on MV3 (invalid there)', () => {
    const manifest = {
      manifest_version: 3,
      background: {service_worker: 'sw.js'}
    } as unknown as Manifest

    const patch = patchBackground(manifest, 'chrome')
    expect('persistent' in (patch.background as object)).toBe(false)
  })

  it('keeps the injected gecko background persistent when none was declared', () => {
    const manifest = {manifest_version: 2} as unknown as Manifest

    const patch = patchBackground(manifest, 'firefox')
    expect((patch.background as {persistent?: boolean}).persistent).toBe(true)
    expect((patch.background as {scripts?: string[]}).scripts).toEqual([
      'background/script.js'
    ])
  })
})
