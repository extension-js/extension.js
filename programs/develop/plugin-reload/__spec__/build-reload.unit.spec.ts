import {describe, expect, it} from 'vitest'
import {loadedContentScriptsFor, reloadForBuild} from '../build-reload'

const SHEET = 'content_scripts/content-0.css'

// A build whose manifest declares one content script with its sheet.
function compile(color: string) {
  const assets: Record<string, string> = {
    [SHEET]: `.probe { color: ${color}; }\n`,
    'manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'x',
      version: '0',
      content_scripts: [
        {
          matches: ['<all_urls>'],
          js: ['content_scripts/content-0.aaaaaaaa.js'],
          css: [SHEET]
        }
      ]
    })
  }

  return {
    errors: [],
    options: {context: '/tmp/ext', output: {path: '/tmp/ext/dist/browser'}},
    getAsset: (name: string) =>
      name in assets ? {source: {source: () => assets[name]}} : undefined
  } as never
}

const saved = (...changedSources: string[]) => ({
  snapshot: () => ({forcedFull: false, changedSources})
})

// Every caller asks here, so one browser name always gets the same answer.
describe('loadedContentScriptsFor', () => {
  it('keeps nothing for the emulator, which reads the file index each reload', () => {
    expect(loadedContentScriptsFor('chromium-emulator')).toBeUndefined()
  })

  it('swaps a rewritten sheet in place on Firefox and reloads Chrome for it', () => {
    const edit = {
      type: 'content-scripts' as const,
      changedContentScriptEntries: ['content_scripts/content-0'],
      changedAssets: ['content/styles.css']
    }

    const answer = (browser: string) => {
      const loaded = loadedContentScriptsFor(browser)

      loaded?.noteLoaded(compile('red'))

      return loaded?.resolve(compile('blue'), edit)
    }

    expect(answer('firefox')).toMatchObject({
      type: 'content-scripts',
      refreshedStylesheets: [expect.objectContaining({file: SHEET})]
    })

    expect(answer('chrome')).toMatchObject({type: 'full'})
  })
})

describe('reloadForBuild', () => {
  it('reloads nothing for a build no saved source explains', () => {
    expect(reloadForBuild(compile('red'), {changedSources: saved()})).toBe(
      undefined
    )
  })

  it('reloads the extension when the saves call for it', () => {
    const changedSources = {
      snapshot: () => ({forcedFull: true, changedSources: ['manifest.json']})
    }

    expect(reloadForBuild(compile('red'), {changedSources})).toMatchObject({
      type: 'full'
    })
  })

  it('compares with what the browser read when that is kept', () => {
    const loaded = loadedContentScriptsFor('chrome')

    loaded?.noteLoaded(compile('red'))

    expect(
      reloadForBuild(compile('blue'), {
        changedSources: saved('content/styles.css'),
        loaded
      })
    ).toMatchObject({type: 'full'})
  })
})
