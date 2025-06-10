import * as path from 'path'
import * as fs from 'fs'
import {describe, it, expect, vi, beforeAll, afterAll} from 'vitest'
import {getManifestFieldsData} from '../../manifest-fields'
import {type PluginInterface} from '../../../../webpack-types'

const mockContext = '/mock/context'
const mockManifestPath = path.join(mockContext, 'manifest.json')

const mockManifestV3 = {
  manifest_version: 3,
  name: 'Test Extension',
  version: '1.0.0',
  action: {
    default_popup: 'popup.html',
    default_icon: {
      '16': 'icons/icon16.png',
      '48': 'icons/icon48.png',
      '128': 'icons/icon128.png'
    }
  },
  browser_action: {
    default_popup: 'browser-popup.html',
    default_icon: {
      '16': 'icons/browser16.png',
      '48': 'icons/browser48.png',
      '128': 'icons/browser128.png'
    },
    theme_icons: [
      {
        light: 'icons/light16.png',
        dark: 'icons/dark16.png',
        size: 16
      },
      {
        light: 'icons/light48.png',
        dark: 'icons/dark48.png',
        size: 48
      }
    ]
  },
  chrome_url_overrides: {
    newtab: 'newtab.html'
  },
  devtools_page: 'devtools.html',
  icons: {
    '16': 'icons/icon16.png',
    '48': 'icons/icon48.png',
    '128': 'icons/icon128.png'
  },
  options_ui: {
    page: 'options.html'
  },
  page_action: {
    default_popup: 'page-popup.html',
    default_icon: {
      '16': 'icons/page16.png',
      '48': 'icons/page48.png',
      '128': 'icons/page128.png'
    }
  },
  sandbox: {
    pages: ['sandbox.html']
  },
  side_panel: {
    default_path: 'sidepanel.html'
  },
  sidebar_action: {
    default_panel: 'sidebar.html',
    default_icon: 'icons/sidebar.png'
  },
  declarative_net_request: {
    rule_resources: [
      {
        id: 'ruleset_1',
        enabled: true,
        path: 'rules.json'
      }
    ]
  },
  storage: {
    managed_schema: 'schema.json'
  },
  default_locale: 'en',
  background: {
    service_worker: 'background.js',
    scripts: ['background-script.js']
  },
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['content.js']
    }
  ],
  user_scripts: {
    api_script: 'user-script.js'
  },
  web_accessible_resources: [
    {
      resources: ['images/*', 'styles/*'],
      matches: ['<all_urls>']
    }
  ]
}

vi.mock('fs', () => ({
  readFileSync: (filePath: fs.PathOrFileDescriptor) => {
    if (filePath === mockManifestPath) {
      return JSON.stringify(mockManifestV3)
    }
    throw new Error(`Unexpected file read: ${filePath}`)
  },
  existsSync: (filePath: fs.PathLike) => {
    if (filePath === path.join(mockContext, '_locales')) {
      return true
    }
    return false
  },
  readdirSync: (filePath: fs.PathLike, options?: {withFileTypes?: boolean}) => {
    const filePathStr = filePath.toString()
    const localesPath = path.join(mockContext, '_locales')
    const enPath = path.join(localesPath, 'en')
    const esPath = path.join(localesPath, 'es')

    if (filePathStr === localesPath) {
      return (options?.withFileTypes
        ? ['en', 'es'].map((name) => ({
            name,
            isDirectory: () => true,
            isFile: () => false
          }))
        : ['en', 'es']) as unknown as fs.Dirent<Buffer>[]
    }

    if (filePathStr === enPath || filePathStr === esPath) {
      return (options?.withFileTypes
        ? ['messages.json'].map((name) => ({
            name,
            isDirectory: () => false,
            isFile: () => true
          }))
        : ['messages.json']) as unknown as fs.Dirent<Buffer>[]
    }

    throw new Error(`Unexpected directory read: ${filePathStr}`)
  },
  statSync: (filePath: fs.PathLike) => {
    if (
      filePath === path.join(mockContext, '_locales', 'en') ||
      filePath === path.join(mockContext, '_locales', 'es')
    ) {
      return {isDirectory: () => true} as fs.Stats
    }
    throw new Error(`Unexpected stat: ${filePath}`)
  }
}))

describe('Manifest Fields', () => {
  const mockPluginInterface: PluginInterface = {
    manifestPath: mockManifestPath,
    browser: 'chrome'
  }

  afterAll(() => {
    vi.restoreAllMocks()
  })

  describe('HTML Fields', () => {
    it('extracts action default_popup', () => {
      const fieldData = getManifestFieldsData(mockPluginInterface)
      expect(fieldData.html['action/default_popup']).toBe(
        path.join(mockContext, 'popup.html')
      )
    })

    it('extracts browser_action default_popup', () => {
      const fieldData = getManifestFieldsData(mockPluginInterface)
      expect(fieldData.html['browser_action/default_popup']).toBe(
        path.join(mockContext, 'browser-popup.html')
      )
    })

    it('extracts chrome_url_overrides', () => {
      const fieldData = getManifestFieldsData(mockPluginInterface)
      expect(fieldData.html['chrome_url_overrides/newtab']).toBe(
        path.join(mockContext, 'newtab.html')
      )
    })

    it('extracts devtools_page', () => {
      const fieldData = getManifestFieldsData(mockPluginInterface)
      expect(fieldData.html.devtools_page).toBe(
        path.join(mockContext, 'devtools.html')
      )
    })

    it('extracts options_ui page', () => {
      const fieldData = getManifestFieldsData(mockPluginInterface)
      expect(fieldData.html['options_ui/page']).toBe(
        path.join(mockContext, 'options.html')
      )
    })

    it('extracts page_action default_popup', () => {
      const fieldData = getManifestFieldsData(mockPluginInterface)
      expect(fieldData.html['page_action/default_popup']).toBe(
        path.join(mockContext, 'page-popup.html')
      )
    })

    it('extracts sandbox pages', () => {
      const fieldData = getManifestFieldsData(mockPluginInterface)
      expect(fieldData.html['sandbox/page-0']).toBe(
        path.join(mockContext, 'sandbox.html')
      )
    })

    it('extracts side_panel default_path', () => {
      const fieldData = getManifestFieldsData(mockPluginInterface)
      expect(fieldData.html['side_panel/default_path']).toBe(
        path.join(mockContext, 'sidepanel.html')
      )
    })

    it('extracts sidebar_action default_panel', () => {
      const fieldData = getManifestFieldsData(mockPluginInterface)
      expect(fieldData.html['sidebar_action/default_panel']).toBe(
        path.join(mockContext, 'sidebar.html')
      )
    })
  })

  describe('Icon Fields', () => {
    it('extracts action icons', () => {
      const fieldData = getManifestFieldsData(mockPluginInterface)
      expect(fieldData.icons.action).toEqual([
        path.join(mockContext, 'icons/icon16.png'),
        path.join(mockContext, 'icons/icon48.png'),
        path.join(mockContext, 'icons/icon128.png')
      ])
    })

    it('extracts browser_action icons', () => {
      const fieldData = getManifestFieldsData(mockPluginInterface)
      expect(fieldData.icons.browser_action).toEqual([
        path.join(mockContext, 'icons/browser16.png'),
        path.join(mockContext, 'icons/browser48.png'),
        path.join(mockContext, 'icons/browser128.png')
      ])
    })

    it('extracts browser_action theme_icons', () => {
      const fieldData = getManifestFieldsData(mockPluginInterface)
      expect(fieldData.icons['browser_action/theme_icons']).toEqual([
        {
          light: path.join(mockContext, 'icons/light16.png'),
          dark: path.join(mockContext, 'icons/dark16.png')
        },
        {
          light: path.join(mockContext, 'icons/light48.png'),
          dark: path.join(mockContext, 'icons/dark48.png')
        }
      ])
    })

    it('extracts icons', () => {
      const fieldData = getManifestFieldsData(mockPluginInterface)
      expect(fieldData.icons.icons).toEqual([
        path.join(mockContext, 'icons/icon16.png'),
        path.join(mockContext, 'icons/icon48.png'),
        path.join(mockContext, 'icons/icon128.png')
      ])
    })

    it('extracts page_action icons', () => {
      const fieldData = getManifestFieldsData(mockPluginInterface)
      expect(fieldData.icons.page_action).toEqual([
        path.join(mockContext, 'icons/page16.png'),
        path.join(mockContext, 'icons/page48.png'),
        path.join(mockContext, 'icons/page128.png')
      ])
    })

    it('extracts sidebar_action icons', () => {
      const fieldData = getManifestFieldsData(mockPluginInterface)
      expect(fieldData.icons.sidebar_action).toBe(
        path.join(mockContext, 'icons/sidebar.png')
      )
    })
  })

  describe('JSON Fields', () => {
    it('extracts declarative_net_request rules', () => {
      const fieldData = getManifestFieldsData(mockPluginInterface)
      expect(fieldData.json['declarative_net_request/ruleset_1']).toBe(
        path.join(mockContext, 'rules.json')
      )
    })

    it('extracts storage managed_schema', () => {
      const fieldData = getManifestFieldsData(mockPluginInterface)
      expect(fieldData.json['storage/managed_schema']).toBe(
        path.join(mockContext, 'schema.json')
      )
    })
  })

  describe('Locales Fields', () => {
    it('extracts locale files', () => {
      const fieldData = getManifestFieldsData(mockPluginInterface)
      expect(fieldData.locales).toEqual([
        path.join(mockContext, '_locales', 'en', 'messages.json'),
        path.join(mockContext, '_locales', 'es', 'messages.json')
      ])
    })
  })

  describe('Scripts Fields', () => {
    it('extracts background scripts', () => {
      const fieldData = getManifestFieldsData(mockPluginInterface)
      expect(fieldData.scripts['background/scripts']).toEqual([
        path.join(mockContext, 'background-script.js')
      ])
    })

    it('extracts background service_worker', () => {
      const fieldData = getManifestFieldsData(mockPluginInterface)
      expect(fieldData.scripts['background/service_worker']).toBe(
        path.join(mockContext, 'background.js')
      )
    })

    it('extracts content scripts', () => {
      const fieldData = getManifestFieldsData(mockPluginInterface)
      expect(fieldData.scripts['content_scripts/content-0']).toEqual([
        path.join(mockContext, 'content.js')
      ])
    })

    it('extracts user scripts', () => {
      const fieldData = getManifestFieldsData(mockPluginInterface)
      expect(fieldData.scripts['user_scripts/api_script']).toBe(
        path.join(mockContext, 'user-script.js')
      )
    })
  })

  describe('Web Resources Fields', () => {
    it('extracts web_accessible_resources', () => {
      const fieldData = getManifestFieldsData(mockPluginInterface)
      expect(fieldData.web_accessible_resources).toEqual([
        {
          resources: ['images/*', 'styles/*'],
          matches: ['<all_urls>']
        }
      ])
    })
  })
})
