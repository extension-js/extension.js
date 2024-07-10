import HandleBrowserSpecificFields from '../plugins/HandleBrowserSpecificFields'

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

describe('HandleBrowserSpecificFields', () => {
  it('should transform manifest for Chrome', () => {
    const handler = new HandleBrowserSpecificFields({
      manifestPath: '',
      browser: 'chrome'
    })

    expect(JSON.parse(handler.patchManifest(manifest))).toEqual({
      background: {
        service_worker: 'sw.js'
      }
    })
  })

  it('should transform manifest for Edge', () => {
    const handler = new HandleBrowserSpecificFields({
      manifestPath: '',
      browser: 'edge'
    })

    expect(JSON.parse(handler.patchManifest(manifest))).toEqual({
      background: {
        service_worker: 'sw.js'
      }
    })
  })

  it('should transform manifest for Firefox', () => {
    const handler = new HandleBrowserSpecificFields({
      manifestPath: '',
      browser: 'firefox'
    })

    expect(JSON.parse(handler.patchManifest(manifest))).toEqual({
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
    const handler = new HandleBrowserSpecificFields({
      manifestPath: '',
      browser: 'safari'
    })

    expect(JSON.parse(handler.patchManifest(manifest))).toEqual({
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
