import {describe, it, expect} from 'vitest'
import patchBackground from '../../../../steps/setup-reload-strategy/apply-manifest-dev-defaults/patch-background'
import {type Manifest} from '../../../../../webpack-types'

describe('patch-background', () => {
  it('should add background script for Firefox when no background is present', () => {
    const manifest = {} as Manifest
    const result = patchBackground(manifest, 'firefox')
    expect(result).toEqual({
      background: {
        scripts: ['background/script.js']
      }
    })
  })

  it('should add background script for Gecko-based browsers when no background is present', () => {
    const manifest = {} as Manifest
    const result = patchBackground(manifest, 'gecko-based')
    expect(result).toEqual({
      background: {
        scripts: ['background/script.js']
      }
    })
  })

  it('should add background script for Manifest V2 when no background is present', () => {
    const manifest = {
      manifest_version: 2
    } as Manifest
    const result = patchBackground(manifest, 'chrome')
    expect(result).toEqual({
      background: {
        scripts: ['background/script.js']
      }
    })
  })

  it('should add service worker for Manifest V3 when no background is present', () => {
    const manifest = {
      manifest_version: 3
    } as Manifest
    const result = patchBackground(manifest, 'chrome')
    expect(result).toEqual({
      background: {
        service_worker: 'background/service_worker.js'
      }
    })
  })

  it('should preserve existing background configuration', () => {
    const manifest = {
      background: {
        scripts: ['custom/background.js'],
        persistent: true
      }
    } as Manifest
    const result = patchBackground(manifest, 'chrome')
    expect(result).toEqual({
      background: {
        scripts: ['custom/background.js'],
        persistent: true
      }
    })
  })

  it('should handle manifest with existing background service worker', () => {
    const manifest = {
      manifest_version: 3,
      background: {
        service_worker: 'custom/worker.js'
      }
    } as Manifest
    const result = patchBackground(manifest, 'chrome')
    expect(result).toEqual({
      background: {
        service_worker: 'custom/worker.js'
      }
    })
  })
})
