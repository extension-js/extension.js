import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {describe, it, expect, beforeAll, afterAll} from 'vitest'
import {getManifestFieldsData} from '../../manifest-fields'

function writeFileEnsured(filePath: string, content: string = ''): void {
  fs.mkdirSync(path.dirname(filePath), {recursive: true})
  fs.writeFileSync(filePath, content)
}

function removeDirIfExists(dirPath: string): void {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, {recursive: true, force: true})
  }
}

describe('getManifestFieldsData', () => {
  let tmpDir: string

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-data-manifest-fields-'))

    // Files referenced by manifest
    writeFileEnsured(
      path.join(tmpDir, 'public', 'popup.html'),
      '<!doctype html>'
    )
    writeFileEnsured(
      path.join(tmpDir, 'public', 'popup-ff.html'),
      '<!doctype html>'
    )
    writeFileEnsured(path.join(tmpDir, 'public', 'new.html'), '<!doctype html>')
    writeFileEnsured(path.join(tmpDir, 'public', 'icons', '16.png'), 'PNG')
    writeFileEnsured(
      path.join(tmpDir, 'sw.js'),
      '// sw root (mv3 allows relative)'
    )
    writeFileEnsured(
      path.join(tmpDir, 'public', 'content.js'),
      'console.log(1)'
    )
    writeFileEnsured(path.join(tmpDir, 'public', 'style.css'), 'body{}')
    writeFileEnsured(path.join(tmpDir, 'rules.json'), '[]')
    writeFileEnsured(path.join(tmpDir, 'public', 'schema.json'), '{}')

    // Locales
    writeFileEnsured(
      path.join(tmpDir, '_locales', 'en', 'messages.json'),
      '{"app_name": {"message": "x"}}'
    )
    writeFileEnsured(
      path.join(tmpDir, '_locales', 'fr', 'messages.json'),
      '{"app_name": {"message": "x"}}'
    )

    // Manifest with browser-specific keys and various fields
    const manifest = {
      name: 'x',
      manifest_version: 3,
      // Chromium-prefixed action; Gecko-prefixed alternative
      'chromium:action': {default_popup: '/popup.html'},
      'gecko:action': {default_popup: '/popup-ff.html'},
      chrome_url_overrides: {newtab: '/new.html'},
      icons: {'16': '/public/icons/16.png'},
      background: {service_worker: 'sw.js'},
      content_scripts: [
        {matches: ['<all_urls>'], js: ['/content.js'], css: ['/style.css']}
      ],
      declarative_net_request: {
        rule_resources: [{id: 'rules', path: 'rules.json'}]
      },
      storage: {managed_schema: '/schema.json'},
      web_accessible_resources: [
        {resources: ['public/icons/16.png'], matches: ['<all_urls>']}
      ]
    }

    writeFileEnsured(
      path.join(tmpDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2)
    )
  })

  afterAll(() => {
    removeDirIfExists(tmpDir)
  })

  it('resolves fields for Chromium-based browsers', () => {
    const result = getManifestFieldsData({
      manifestPath: path.join(tmpDir, 'manifest.json'),
      browser: 'chrome'
    })

    // HTML
    expect(result.html['action/index']).toBe(path.join(tmpDir, 'popup.html'))
    expect(result.html['chrome_url_overrides/newtab']).toBe(
      path.join(tmpDir, 'new.html')
    )

    // Icons
    expect(result.icons.icons).toContain(
      path.join(tmpDir, 'public', 'icons', '16.png')
    )

    // JSON
    expect(result.json['declarative_net_request/rules']).toBe(
      path.join(tmpDir, 'rules.json')
    )
    expect(result.json['storage/managed_schema']).toBe(
      path.join(tmpDir, 'schema.json')
    )

    // Scripts
    expect(result.scripts['background/service_worker']).toBe(
      path.join(tmpDir, 'sw.js')
    )
    expect(result.scripts['content_scripts/content-0']).toEqual([
      path.join(tmpDir, 'content.js'),
      path.join(tmpDir, 'style.css')
    ])

    // Web resources passthrough
    expect(result.web_accessible_resources).toEqual([
      {resources: ['public/icons/16.png'], matches: ['<all_urls>']}
    ])

    // Locales (not part of documented API, but present)
    // Ensure it resolves files if folder exists
    expect(result.locales?.length).toBeGreaterThan(0)
  })

  it('resolves browser-prefixed manifest keys for Firefox/Gecko', () => {
    const result = getManifestFieldsData({
      manifestPath: path.join(tmpDir, 'manifest.json'),
      browser: 'gecko-based'
    })

    expect(result.html['action/index']).toBe(path.join(tmpDir, 'popup-ff.html'))
  })
})

// Below: additional test cases for MV2/MV3 field resolution

const fakeManifestV2: chrome.runtime.ManifestV2 = {
  manifest_version: 2,
  name: 'Super Extension',
  version: '1.0.0',
  action: {
    default_popup: 'action/default_popup.html',
    default_icon: 'action/icon.png'
  },
  background: {
    page: 'background.html',
    scripts: ['background.js', 'background2.js']
  },
  browser_action: {
    default_icon: 'browser_action/icon16.png',
    default_popup: 'browser_action/default_popup.html',
    // @ts-expect-error this is specific for Firefox
    theme_icons: [
      {
        light: 'browser_action/icon16-light.png',
        dark: 'browser_action/icon16-dark.png',
        size: 16
      },
      {
        light: 'browser_action/icon16-light.png',
        dark: 'browser_action/icon16-dark.png',
        size: 16
      }
    ]
  },
  chrome_url_overrides: {
    bookmarks: 'chrome_url_overrides/bookmarks.html',
    history: 'chrome_url_overrides/history.html',
    newtab: 'chrome_url_overrides/newtab.html'
  },
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['content_scripts/content-0.js', 'content_scripts/content-0.js'],
      css: ['content_scripts/content-0.css', 'content_scripts/content-0.css']
    },
    {
      matches: ['<all_urls>'],
      js: ['content_scripts/content-1.js', 'content_scripts/content-1.js'],
      css: ['content_scripts/content-1.css', 'content_scripts/content-1.css']
    }
  ],
  declarative_net_request: {
    rule_resources: [
      {
        id: 'block_ads',
        enabled: true,
        path: 'declarative_net_request/block_ads.json'
      }
    ]
  },
  devtools_page: 'devtools_page.html',
  icons: {
    '16': 'icons/icon16.png',
    '48': 'icons/icon48.png',
    '128': 'icons/icon128.png'
  },
  options_page: 'options_ui/page.html',
  options_ui: {
    page: 'options_ui/page.html'
  },
  page_action: {
    default_icon: 'page_action/icon16.png',
    default_popup: 'page_action/default_popup.html'
  },
  sandbox: {
    pages: ['sandbox/page-0.html', 'sandbox/page-1.html']
  },
  sidebar_action: {
    default_panel: 'sidebar_action/default_panel.html',
    default_icon: 'sidebar_action/icon16.png'
  },
  storage: {
    managed_schema: 'storage/managed_schema.json'
  },
  theme: {
    images: {
      theme_frame: 'theme/images/theme_frame.png'
    }
  },
  user_scripts: {
    api_script: 'user_scripts/api_script.js'
  },
  web_accessible_resources: ['images/my-image.png', 'script.js', 'styles.css'],
  side_panel: {
    default_path: 'side_panel/default_path.html'
  }
}

const fakeManifestV3: Partial<chrome.runtime.ManifestV3> = {
  ...(fakeManifestV2 as any),
  manifest_version: 3,
  background: {
    service_worker: 'background/sw.js'
  },
  web_accessible_resources: [
    {
      resources: ['images/my-image.png', 'script.js', 'styles.css'],
      matches: ['<all_urls>']
    },
    {
      resources: ['images/my-image2.png', 'script2.js', 'styles2.css'],
      matches: ['https://google.com/*']
    }
  ]
}

const manifestV2Path = path.join(__dirname, 'manifest-v2.json')
const manifestV3Path = path.join(__dirname, 'manifest-v3.json')

describe('getManifestFieldsData', () => {
  afterAll(() => {
    if (fs.existsSync(manifestV2Path)) {
      fs.unlinkSync(manifestV2Path)
    }
    if (fs.existsSync(manifestV3Path)) {
      fs.unlinkSync(manifestV3Path)
    }
  })

  it('should transform manifest action details correctly for manifest v2', () => {
    fs.writeFileSync(manifestV2Path, JSON.stringify(fakeManifestV2, null, 2))

    const allFields = getManifestFieldsData({manifestPath: manifestV2Path})
    const extensionPath = path.dirname(manifestV2Path)

    expect(allFields).toEqual({
      html: {
        'action/index': path.join(extensionPath, 'action/default_popup.html'),
        'background/index': path.join(extensionPath, 'background.html'),
        'chrome_url_overrides/bookmarks': path.join(
          extensionPath,
          'chrome_url_overrides/bookmarks.html'
        ),
        'devtools/index': path.join(extensionPath, 'devtools_page.html'),
        'options/index': path.join(extensionPath, 'options_ui/page.html'),
        'sandbox/page-0': path.join(extensionPath, 'sandbox/page-0.html'),
        'sandbox/page-1': path.join(extensionPath, 'sandbox/page-1.html'),
        'sidebar/index': path.join(
          extensionPath,
          'side_panel/default_path.html'
        )
      },
      icons: {
        action: path.join(extensionPath, 'action/icon.png'),
        browser_action: path.join(extensionPath, 'browser_action/icon16.png'),
        'browser_action/theme_icons': [
          {
            dark: path.join(extensionPath, 'browser_action/icon16-dark.png'),
            light: path.join(extensionPath, 'browser_action/icon16-light.png')
          },
          {
            dark: path.join(extensionPath, 'browser_action/icon16-dark.png'),
            light: path.join(extensionPath, 'browser_action/icon16-light.png')
          }
        ],
        icons: [
          path.join(extensionPath, 'icons/icon16.png'),
          path.join(extensionPath, 'icons/icon48.png'),
          path.join(extensionPath, 'icons/icon128.png')
        ],
        page_action: path.join(extensionPath, 'page_action/icon16.png'),
        sidebar_action: path.join(extensionPath, 'sidebar_action/icon16.png')
      },
      json: {
        'declarative_net_request/block_ads': path.join(
          extensionPath,
          'declarative_net_request/block_ads.json'
        ),
        'storage/managed_schema': path.join(
          extensionPath,
          'storage/managed_schema.json'
        )
      },
      scripts: {
        'background/scripts': [
          path.join(extensionPath, 'background.js'),
          path.join(extensionPath, 'background2.js')
        ],
        'background/service_worker': undefined,
        'content_scripts/content-0': [
          path.join(extensionPath, 'content_scripts/content-0.js'),
          path.join(extensionPath, 'content_scripts/content-0.js'),
          path.join(extensionPath, 'content_scripts/content-0.css'),
          path.join(extensionPath, 'content_scripts/content-0.css')
        ],
        'content_scripts/content-1': [
          path.join(extensionPath, 'content_scripts/content-1.js'),
          path.join(extensionPath, 'content_scripts/content-1.js'),
          path.join(extensionPath, 'content_scripts/content-1.css'),
          path.join(extensionPath, 'content_scripts/content-1.css')
        ],
        'user_scripts/api_script': path.join(
          extensionPath,
          'user_scripts/api_script.js'
        )
      },
      web_accessible_resources: [
        'images/my-image.png',
        'script.js',
        'styles.css'
      ],
      locales: []
    })
  })

  it('should transform manifest action details correctly for manifest v3', () => {
    fs.writeFileSync(manifestV3Path, JSON.stringify(fakeManifestV3, null, 2))

    const allFields = getManifestFieldsData({manifestPath: manifestV3Path})
    const extensionPath = path.dirname(manifestV3Path)

    expect(allFields).toEqual({
      html: {
        'action/index': path.join(extensionPath, 'action/default_popup.html'),
        'chrome_url_overrides/bookmarks': path.join(
          extensionPath,
          'chrome_url_overrides/bookmarks.html'
        ),
        'devtools/index': path.join(extensionPath, 'devtools_page.html'),
        'options/index': path.join(extensionPath, 'options_ui/page.html'),
        'sandbox/page-0': path.join(extensionPath, 'sandbox/page-0.html'),
        'sandbox/page-1': path.join(extensionPath, 'sandbox/page-1.html'),
        'sidebar/index': path.join(
          extensionPath,
          'side_panel/default_path.html'
        )
      },
      icons: {
        action: path.join(extensionPath, 'action/icon.png'),
        browser_action: path.join(extensionPath, 'browser_action/icon16.png'),
        'browser_action/theme_icons': [
          {
            dark: path.join(extensionPath, 'browser_action/icon16-dark.png'),
            light: path.join(extensionPath, 'browser_action/icon16-light.png')
          },
          {
            dark: path.join(extensionPath, 'browser_action/icon16-dark.png'),
            light: path.join(extensionPath, 'browser_action/icon16-light.png')
          }
        ],
        icons: [
          path.join(extensionPath, 'icons/icon16.png'),
          path.join(extensionPath, 'icons/icon48.png'),
          path.join(extensionPath, 'icons/icon128.png')
        ],
        page_action: path.join(extensionPath, 'page_action/icon16.png'),
        sidebar_action: path.join(extensionPath, 'sidebar_action/icon16.png')
      },
      json: {
        'declarative_net_request/block_ads': path.join(
          extensionPath,
          'declarative_net_request/block_ads.json'
        ),
        'storage/managed_schema': path.join(
          extensionPath,
          'storage/managed_schema.json'
        )
      },
      scripts: {
        'background/scripts': undefined,
        'background/service_worker': path.join(
          extensionPath,
          'background/sw.js'
        ),
        'content_scripts/content-0': [
          path.join(extensionPath, 'content_scripts/content-0.js'),
          path.join(extensionPath, 'content_scripts/content-0.js'),
          path.join(extensionPath, 'content_scripts/content-0.css'),
          path.join(extensionPath, 'content_scripts/content-0.css')
        ],
        'content_scripts/content-1': [
          path.join(extensionPath, 'content_scripts/content-1.js'),
          path.join(extensionPath, 'content_scripts/content-1.js'),
          path.join(extensionPath, 'content_scripts/content-1.css'),
          path.join(extensionPath, 'content_scripts/content-1.css')
        ],
        'user_scripts/api_script': path.join(
          extensionPath,
          'user_scripts/api_script.js'
        )
      },
      web_accessible_resources: [
        {
          matches: ['<all_urls>'],
          resources: ['images/my-image.png', 'script.js', 'styles.css']
        },
        {
          matches: ['https://google.com/*'],
          resources: ['images/my-image2.png', 'script2.js', 'styles2.css']
        }
      ],
      locales: []
    })
  })
})
