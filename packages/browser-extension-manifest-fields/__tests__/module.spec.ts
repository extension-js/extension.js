import {type Manifest} from '../types'
import manifestFields from '../dist/module'

const fakeManifestV2: Manifest = {
  manifest_version: 2,
  name: 'Super Extension',
  version: '1.0.0',
  action: {
    default_popup: 'action/default_popup.html',
    default_icon: 'action/icon.png'
  },
  background: {
    page: 'background.html',
    scripts: ['background.js', 'background2.js'],
    service_worker: 'background/service_worker.js'
  },
  browser_action: {
    default_icon: 'browser_action/icon16.png',
    default_popup: 'browser_action/default_popup.html',
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

// const fakeManifestV3: Manifest = {
//   ...fakeManifestV2,
//   manifest_version: 2,
//   web_accessible_resources: [
//     {
//       resources: ['images/my-image.png', 'script.js', 'styles.css'],
//       matches: ['<all_urls>']
//     },
//     {
//       resources: ['images/my-image2.png', 'script2.js', 'styles2.css'],
//       matches: ['https://google.com/*']
//     }
//   ]
// }

describe('manifestFields', () => {
  const allFields = manifestFields('manifest.json', fakeManifestV2)

  it('should transform manifest action details correctly', () => {
    expect(allFields).toEqual({
      html: {
        'action/default_popup': {
          css: [],
          html: 'action/default_popup.html',
          js: [],
          static: []
        },
        'background/page': {
          css: [],
          html: 'background.html',
          js: [],
          static: []
        },
        'browser_action/default_popup': {
          css: [],
          html: 'browser_action/default_popup.html',
          js: [],
          static: []
        },
        'chrome_settings_overrides/homepage': undefined,
        'chrome_url_overrides/bookmarks': {
          css: [],
          html: 'chrome_url_overrides/bookmarks.html',
          js: [],
          static: []
        },
        devtools_page: {
          css: [],
          html: 'devtools_page.html',
          js: [],
          static: []
        },
        'options_ui/page': {
          css: [],
          html: 'options_ui/page.html',
          js: [],
          static: []
        },
        'page_action/default_popup': {
          css: [],
          html: 'page_action/default_popup.html',
          js: [],
          static: []
        },
        'sandbox/page-0': {
          css: [],
          html: 'sandbox/page-0.html',
          js: [],
          static: []
        },
        'sandbox/page-1': {
          css: [],
          html: 'sandbox/page-1.html',
          js: [],
          static: []
        },
        'side_panel/default_path': {
          css: [],
          html: 'side_panel/default_path.html',
          js: [],
          static: []
        },
        'sidebar_action/default_panel': {
          css: [],
          html: 'sidebar_action/default_panel.html',
          js: [],
          static: []
        }
      },
      icons: {
        action: 'action/icon.png',
        browser_action:
          '/Users/cezaraugusto/local/00-extension-create/browser_action/icon16.png',
        'browser_action/theme_icons': [
          {
            dark: '/Users/cezaraugusto/local/00-extension-create/browser_action/icon16-dark.png',
            light:
              '/Users/cezaraugusto/local/00-extension-create/browser_action/icon16-light.png'
          },
          {
            dark: '/Users/cezaraugusto/local/00-extension-create/browser_action/icon16-dark.png',
            light:
              '/Users/cezaraugusto/local/00-extension-create/browser_action/icon16-light.png'
          }
        ],
        icons: ['icons/icon16.png', 'icons/icon48.png', 'icons/icon128.png'],
        page_action: 'page_action/icon16.png',
        sidebar_action: 'sidebar_action/icon16.png'
      },
      json: {
        'declarative_net_request/block_ads':
          'declarative_net_request/block_ads.json',
        'storage/managed_schema': 'storage/managed_schema.json'
      },
      locales: [],
      scripts: {
        'background/scripts': ['background.js', 'background2.js'],
        'background/service_worker': 'background/service_worker.js',
        'content_scripts/content-0': [
          'content_scripts/content-0.js',
          'content_scripts/content-0.js',
          'content_scripts/content-0.css',
          'content_scripts/content-0.css'
        ],
        'content_scripts/content-1': [
          'content_scripts/content-1.js',
          'content_scripts/content-1.js',
          'content_scripts/content-1.css',
          'content_scripts/content-1.css'
        ],
        'user_scripts/api_script': 'user_scripts/api_script.js'
      },
      web_accessible_resources: [
        'images/my-image.png',
        'script.js',
        'styles.css'
      ]
    })
  })
})
