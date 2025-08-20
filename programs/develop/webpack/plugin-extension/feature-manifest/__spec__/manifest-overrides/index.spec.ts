import * as path from 'path'
import * as fs from 'fs'
import os from 'os'
import {describe, it, expect} from 'vitest'
import {getManifestOverrides} from '../../manifest-overrides'
import {FilepathList, Manifest} from '../../../../webpack-types'

const SUPER_MANIFEST: Manifest = {
  action: {
    default_popup: 'popup.html',
    default_icon: 'icon.png'
  },
  background: {
    page: 'background.html',
    scripts: ['background.js', 'background2.js'],
    service_worker: 'service-worker.js'
  },
  browser_action: {
    default_icon: 'icons/icon16.png',
    default_popup: 'popup.html',
    theme_icons: [
      {
        light: 'icons/icon16-light.png',
        dark: 'icons/icon16-dark.png',
        size: 16
      },
      {
        light: 'icons2/icon16-light.png',
        dark: 'icons2/icon16-dark.png',
        size: 16
      }
    ]
  },
  chrome_url_overrides: {
    newtab: 'newtab.html',
    bookmarks: 'bookmarks.html',
    history: 'history.html'
  },
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['content1.js', 'content2.js'],
      css: ['content1.css', 'content2.css']
    },
    {
      matches: ['<all_urls>'],
      js: ['content3.js', 'content4.js'],
      css: ['content3.css', 'content4.css']
    }
  ],
  declarative_net_request: {
    rule_resources: [
      {
        id: 'block_ads',
        enabled: true,
        path: 'block_ads.json'
      }
    ]
  },
  devtools_page: 'devtools.html',
  icons: {
    '16': 'icons/icon16.png',
    '48': 'icons/icon48.png',
    '128': 'icons/icon128.png'
  },
  options_page: 'options.html',
  options_ui: {
    page: 'options.html'
  },
  page_action: {
    default_icon: 'icons/icon16.png',
    default_popup: 'popup.html'
  },
  sandbox: {
    pages: ['sandbox.html', 'sandbox2.html']
  },
  sidebar_action: {
    default_panel: 'sidebar.html',
    default_icon: 'icons/icon16.png'
  },
  storage: {
    managed_schema: 'schema.json'
  },
  theme: {
    images: {
      theme_frame: 'images/theme_frame.png'
    }
  },
  user_scripts: {
    api_script: 'api.js'
  },
  web_accessible_resources: [
    'images/my-image.png',
    'script.js',
    'styles.css'
  ] as any,
  side_panel: {
    default_icon: 'icons/icon16.png',
    default_path: 'panel.html'
  },
  name: 'super-manifest',
  description: 'An Extension.js example.',
  version: '0.0.1'
}

export const assertFileIsEmitted = async (filePath: string) => {
  const fileIsEmitted = await fs.promises.access(filePath, fs.constants.F_OK)
  return expect(fileIsEmitted).toBeUndefined()
}

export const assertFileIsNotEmitted = async (filePath: string) => {
  await fs.promises.access(filePath, fs.constants.F_OK).catch((err) => {
    expect(err).toBeTruthy()
  })
}

export const findStringInFile = async (filePath: string, string: string) => {
  const data = await fs.promises.readFile(filePath, 'utf8')
  expect(data).toContain(string)
}

export const dirname = (dir: string) => path.dirname(dir)

export const win32 = () => os.platform() === 'win32'

describe('getManifestOverrides', () => {
  const context = path.resolve(__dirname, 'context')
  const exclude: FilepathList = win32()
    ? {
        fileA: `${context}\\icons\\icon16.png`,
        fileB: `${context}\\icons\\icon48.png`,
        fileC: `${context}\\icons\\icon128.png`
      }
    : {
        fileA: 'icons/icon16.png',
        fileB: 'icons/icon48.png',
        fileC: 'icons/icon128.png'
      }

  it('should transform manifest action details correctly', () => {
    const result = getManifestOverrides(
      'NOT_AVAILABLE',
      SUPER_MANIFEST,
      exclude
    )

    expect(JSON.parse(result)).toEqual({
      name: 'super-manifest',
      version: '0.0.1',
      description: 'An Extension.js example.',
      action: {
        default_popup: 'action/default_popup.html',
        default_icon: 'icons/icon.png'
      },
      background: {
        page: 'background.html',
        scripts: ['background.js', 'background2.js'],
        service_worker: 'background/service_worker.js'
      },
      browser_action: {
        default_icon: 'icons/icon16.png',
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
          css: [
            'content_scripts/content-0.css',
            'content_scripts/content-0.css'
          ]
        },
        {
          matches: ['<all_urls>'],
          js: ['content_scripts/content-1.js', 'content_scripts/content-1.js'],
          css: [
            'content_scripts/content-1.css',
            'content_scripts/content-1.css'
          ]
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
      devtools_page: 'devtools_page/devtools_page.html',
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
        default_icon: 'icons/icon16.png',
        default_popup: 'page_action/default_popup.html'
      },
      sandbox: {
        pages: ['sandbox/page-0.html', 'sandbox/page-1.html']
      },
      sidebar_action: {
        default_panel: 'sidebar_action/default_panel.html',
        default_icon: 'icons/icon16.png'
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
      web_accessible_resources: [
        'images/my-image.png',
        'script.js',
        'styles.css'
      ],
      side_panel: {
        default_icon: 'icons/icon16.png',
        default_path: 'side_panel/default_path.html'
      }
    })
  })
})
