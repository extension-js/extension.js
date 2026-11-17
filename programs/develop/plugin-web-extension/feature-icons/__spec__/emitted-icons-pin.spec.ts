import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {openDevWatchSession} from '../../../__spec__/helpers/dev-watch-session'
import {trackTempFolders} from '../../../__spec__/helpers/temp-folders'

// Real builds of projects with an icon in every manifest field that takes
// one. Each icon has its own bytes, so the output says which source a shipped
// file came from, and a file that goes missing or changes shows up by name.
const tempFolder = trackTempFolders()

const icon = (name: string) =>
  Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    Buffer.from(name)
  ])

interface Fixture {
  browser: 'chrome' | 'firefox'
  manifest: Record<string, unknown>
  icons: string[]
  files?: Record<string, string>
  shipped: Record<string, string>
}

const page = '<!doctype html><html><body><p>page</p></body></html>\n'

const fixtures: Record<string, Fixture> = {
  'chrome MV3': {
    browser: 'chrome',
    manifest: {
      manifest_version: 3,
      icons: {
        '16': 'icons/app-16.png',
        '48': 'icons/app-48.png',
        '128': '/shared-128.png'
      },
      icon_variants: [
        {'16': 'variants/light-16.png', color_schemes: ['light']},
        {'16': 'variants/dark-16.png', color_schemes: ['dark']}
      ],
      action: {
        default_icon: {
          '16': 'images/action-16.png',
          '32': 'images/action-32.png'
        },
        icon_variants: [{'16': 'variants/action-16.png'}]
      },
      omnibox: {keyword: 'pin', default_icon: {'16': 'images/omnibox-16.png'}},
      chrome_settings_overrides: {
        search_provider: {
          name: 'Pin',
          keyword: 'pin',
          search_url: 'https://example.com/?q={searchTerms}',
          favicon_url: 'search/favicon.png',
          encoding: 'UTF-8',
          is_default: true
        }
      }
    },
    icons: [
      'icons/app-16.png',
      'icons/app-48.png',
      'public/shared-128.png',
      'variants/light-16.png',
      'variants/dark-16.png',
      'variants/action-16.png',
      'images/action-16.png',
      'images/action-32.png',
      'images/omnibox-16.png',
      'search/favicon.png'
    ],
    shipped: {
      'chrome_settings_overrides/favicon.png': 'search/favicon.png',
      'icons/app-16.png': 'icons/app-16.png',
      'icons/app-48.png': 'icons/app-48.png',
      'images/action-16.png': 'images/action-16.png',
      'images/action-32.png': 'images/action-32.png',
      'images/omnibox-16.png': 'images/omnibox-16.png',
      'shared-128.png': 'public/shared-128.png',
      'variants/action-16.png': 'variants/action-16.png',
      'variants/dark-16.png': 'variants/dark-16.png',
      'variants/light-16.png': 'variants/light-16.png'
    }
  },
  'firefox MV2': {
    browser: 'firefox',
    manifest: {
      manifest_version: 2,
      icons: {'48': 'icons/app-48.png'},
      browser_action: {
        default_icon: {'16': 'images/toolbar-16.png'},
        theme_icons: [
          {light: 'themed/light-16.png', dark: 'themed/dark-16.png', size: 16}
        ]
      },
      page_action: {default_icon: {'19': 'images/address-19.png'}},
      sidebar_action: {
        default_icon: 'images/sidebar.png',
        default_panel: 'sidebar.html'
      }
    },
    icons: [
      'icons/app-48.png',
      'images/toolbar-16.png',
      'themed/light-16.png',
      'themed/dark-16.png',
      'images/address-19.png',
      'images/sidebar.png'
    ],
    files: {'sidebar.html': page},
    shipped: {
      'browser_action/themed/dark-16.png': 'themed/dark-16.png',
      'browser_action/themed/light-16.png': 'themed/light-16.png',
      'icons/app-48.png': 'icons/app-48.png',
      'images/address-19.png': 'images/address-19.png',
      'images/sidebar.png': 'images/sidebar.png',
      'images/toolbar-16.png': 'images/toolbar-16.png'
    }
  },
  'firefox MV3': {
    browser: 'firefox',
    manifest: {
      manifest_version: 3,
      icons: {'48': 'icons/app-48.png'},
      action: {
        default_icon: {'16': 'images/toolbar-16.png'},
        theme_icons: [
          {light: 'themed/light-16.png', dark: 'themed/dark-16.png', size: 16}
        ]
      }
    },
    icons: [
      'icons/app-48.png',
      'images/toolbar-16.png',
      'themed/light-16.png',
      'themed/dark-16.png'
    ],
    shipped: {
      'action/themed/dark-16.png': 'themed/dark-16.png',
      'action/themed/light-16.png': 'themed/light-16.png',
      'icons/app-48.png': 'icons/app-48.png',
      'images/toolbar-16.png': 'images/toolbar-16.png'
    }
  },
  'firefox theme': {
    browser: 'firefox',
    manifest: {
      manifest_version: 2,
      icons: {'48': 'icons/app-48.png'},
      theme: {
        images: {
          theme_frame: 'frames/frame.png',
          additional_backgrounds: ['backgrounds/one.png', 'backgrounds/two.png']
        },
        colors: {frame: '#ffffff', tab_background_text: '#000000'}
      }
    },
    icons: [
      'icons/app-48.png',
      'frames/frame.png',
      'backgrounds/one.png',
      'backgrounds/two.png'
    ],
    shipped: {
      'icons/app-48.png': 'icons/app-48.png',
      'theme/images/backgrounds/one.png': 'backgrounds/one.png',
      'theme/images/backgrounds/two.png': 'backgrounds/two.png',
      'theme/images/frames/frame.png': 'frames/frame.png'
    }
  }
}

function project(fixture: Fixture): string {
  const root = fs.realpathSync(tempFolder('extjs-icons-pin-'))

  const write = (name: string, contents: string | Buffer) => {
    fs.mkdirSync(path.dirname(path.join(root, name)), {recursive: true})
    fs.writeFileSync(path.join(root, name), contents)
  }

  write(
    'package.json',
    JSON.stringify({private: true, name: 'icons-pin', version: '0.0.0'})
  )

  write(
    'manifest.json',
    JSON.stringify({name: 'Icons pin', version: '1.0.0', ...fixture.manifest})
  )

  for (const name of fixture.icons) write(name, icon(name))

  for (const [name, contents] of Object.entries(fixture.files || {})) {
    write(name, contents)
  }

  return root
}

function filesUnder(folder: string, prefix = ''): string[] {
  if (!fs.existsSync(folder)) return []

  return fs.readdirSync(folder, {withFileTypes: true}).flatMap((entry) => {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name

    return entry.isDirectory()
      ? filesUnder(path.join(folder, entry.name), rel)
      : [rel]
  })
}

// Every image the build shipped, by output name, with the fixture icon
// whose bytes it carries. A shipped image with other bytes reads `changed`.
function shippedIcons(root: string, distPath: string, fixture: Fixture) {
  const shipped: Record<string, string> = {}

  for (const name of filesUnder(distPath).sort()) {
    if (!/\.png$/i.test(name)) continue

    const bytes = fs.readFileSync(path.join(distPath, name))
    const source = fixture.icons.find((candidate) =>
      fs.readFileSync(path.join(root, candidate)).equals(bytes)
    )

    shipped[name] = source || 'changed'
  }

  return shipped
}

async function productionBuild(fixture: Fixture) {
  const root = project(fixture)
  const {extensionBuild} = await import('../../../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'

  try {
    const summary = await extensionBuild(root, {
      browser: fixture.browser,
      silent: true,
      install: false,
      mode: 'production',
      exitOnError: false
    } as any)

    expect(summary.errors_count).toBe(0)
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }

  return shippedIcons(root, path.join(root, 'dist', fixture.browser), fixture)
}

async function devBuild(fixture: Fixture) {
  const root = project(fixture)
  const session = await openDevWatchSession(root, fixture.browser)

  try {
    await session.settle()

    return shippedIcons(root, session.distPath, fixture)
  } finally {
    await session.close()
  }
}

describe('the icon files a build ships', () => {
  for (const [name, fixture] of Object.entries(fixtures)) {
    it(`production, ${name}`, async () => {
      expect(await productionBuild(fixture)).toEqual(fixture.shipped)
    }, 120000)

    it(`development, ${name}`, async () => {
      expect(await devBuild(fixture)).toEqual(fixture.shipped)
    }, 120000)
  }
})
