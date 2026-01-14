import {describe, it, expect} from 'vitest'
import {BrowserSpecificFieldsPlugin} from '../feature-browser-specific-fields'

const manifest = JSON.stringify({
  'firefox:developer': {
    name: 'extension.js',
    url: 'https://extension.js'
  },
  'firefox:browser_specific_settings': {
    gecko: {
      id: 'addon@example.com',
      strict_min_version: '42.0'
    }
  },
  'safari:browser_specific_settings': {
    safari: {
      strict_min_version: '15.4',
      strict_max_version: '*'
    }
  },
  background: {
    'chromium:service_worker': 'sw.js',
    'safari:service_worker': 'sw.js',
    'firefox:scripts': ['bg.js']
  }
})

describe('BrowserSpecificFieldsPlugin', () => {
  it('should transform manifest for Chrome', () => {
    const handler = new BrowserSpecificFieldsPlugin({
      manifestPath: '',
      browser: 'chrome'
    })

    expect(JSON.parse(handler.patchManifest(JSON.parse(manifest)))).toEqual({
      background: {
        service_worker: 'sw.js'
      }
    })
  })

  it('should transform manifest for Edge', () => {
    const handler = new BrowserSpecificFieldsPlugin({
      manifestPath: '',
      browser: 'edge'
    })

    expect(JSON.parse(handler.patchManifest(JSON.parse(manifest)))).toEqual({
      background: {
        service_worker: 'sw.js'
      }
    })
  })

  it('should transform manifest for Firefox', () => {
    const handler = new BrowserSpecificFieldsPlugin({
      manifestPath: '',
      browser: 'firefox'
    })

    expect(JSON.parse(handler.patchManifest(JSON.parse(manifest)))).toEqual({
      developer: {
        name: 'extension.js',
        url: 'https://extension.js'
      },
      browser_specific_settings: {
        gecko: {
          id: 'addon@example.com',
          strict_min_version: '42.0'
        }
      },
      background: {
        scripts: ['bg.js']
      }
    })
  })

  it('should transform manifest for Safari', () => {
    const handler = new BrowserSpecificFieldsPlugin({
      manifestPath: '',
      browser: 'safari' as any
    })

    expect(JSON.parse(handler.patchManifest(JSON.parse(manifest)))).toEqual({
      browser_specific_settings: {
        safari: {
          strict_min_version: '15.4',
          strict_max_version: '*'
        }
      },
      background: {
        service_worker: 'sw.js'
      }
    })
  })
})

