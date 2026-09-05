import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {
  settingsOverridesIconFields,
  settingsOverridesStartupPages,
  themeExperimentStylesheetEntries
} from '../manifest-path-assets'
import {isManifestAddress} from '../paths'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0))
    fs.rmSync(dir, {recursive: true, force: true})
})

function manifestWith(content: unknown, files: string[] = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-path-assets-'))
  dirs.push(dir)
  for (const file of files) {
    const abs = path.join(dir, file)
    fs.mkdirSync(path.dirname(abs), {recursive: true})
    fs.writeFileSync(abs, 'x')
  }
  const manifestPath = path.join(dir, 'manifest.json')
  fs.writeFileSync(manifestPath, JSON.stringify(content))
  return {dir, manifestPath}
}

describe('isManifestAddress', () => {
  it('accepts schemes and protocol-relative urls, not packaged paths', () => {
    expect(isManifestAddress('https://example.com/')).toBe(true)
    expect(isManifestAddress('about:blank')).toBe(true)
    expect(isManifestAddress('//cdn.example/fav.png')).toBe(true)
    expect(isManifestAddress('icons/fav.png')).toBe(false)
    expect(isManifestAddress('/fav.png')).toBe(false)
    expect(isManifestAddress('C:/fav.png')).toBe(false)
  })
})

describe('themeExperimentStylesheetEntries', () => {
  it('turns the stylesheet into a css entry named after the file', () => {
    const {dir, manifestPath} = manifestWith(
      {theme_experiment: {stylesheet: 'theme/chrome.scss'}},
      ['theme/chrome.scss']
    )
    expect(themeExperimentStylesheetEntries(manifestPath)).toEqual({
      'theme_experiment/chrome': [path.join(dir, 'theme', 'chrome.scss')]
    })
  })

  it('leaves public-hosted stylesheets to the copier', () => {
    const {manifestPath} = manifestWith({
      theme_experiment: {stylesheet: 'public/chrome.css'}
    })
    expect(themeExperimentStylesheetEntries(manifestPath)).toEqual({})
  })
})

describe('settingsOverridesIconFields', () => {
  it('feeds a packaged favicon to the icons emitter and skips addresses', () => {
    const {dir, manifestPath} = manifestWith({
      chrome_settings_overrides: {
        search_provider: {favicon_url: 'icons/fav.png'}
      }
    })
    expect(settingsOverridesIconFields(manifestPath)).toEqual({
      'chrome_settings_overrides/favicon_url': path.join(
        dir,
        'icons',
        'fav.png'
      )
    })
    const remote = manifestWith({
      chrome_settings_overrides: {
        search_provider: {favicon_url: 'https://cdn.example/fav.png'}
      }
    })
    expect(settingsOverridesIconFields(remote.manifestPath)).toEqual({})
  })
})

describe('settingsOverridesStartupPages', () => {
  it('feeds packaged pages to the html emitter by index and skips addresses', () => {
    const {dir, manifestPath} = manifestWith(
      {
        chrome_settings_overrides: {
          startup_pages: ['https://example.com/', 'pages/start.html']
        }
      },
      ['pages/start.html']
    )
    expect(settingsOverridesStartupPages(manifestPath)).toEqual({
      'chrome_settings_overrides/startup-1': path.join(
        dir,
        'pages',
        'start.html'
      )
    })
  })
})
