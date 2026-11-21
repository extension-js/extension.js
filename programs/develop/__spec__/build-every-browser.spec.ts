import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {buildProject} from './helpers/build-project'
import {writeExtensionProject} from './helpers/extension-project'
import {trackTempFolders} from './helpers/temp-folders'

// Most build specs name Chrome because the browser is not what they are
// about. This one builds the same project for every name a build accepts.
const tempFolder = trackTempFolders()

const FAMILIES = {
  chromium: [
    'chrome',
    'edge',
    'chromium',
    'brave',
    'opera',
    'vivaldi',
    'yandex',
    'chromium-based',
    'chromium-emulator'
  ],
  gecko: [
    'firefox',
    'waterfox',
    'librewolf',
    'zen',
    'floorp',
    'gecko-based',
    'firefox-based'
  ],
  webkit: ['safari', 'webkit-based']
} as const

const EVERY_BROWSER = Object.entries(FAMILIES).flatMap(([family, names]) =>
  names.map((browser) => ({browser, family}))
)

function project() {
  return writeExtensionProject(tempFolder('extjs-every-browser-'), {
    name: 'every-browser',
    manifest: {
      'chromium:background': {service_worker: 'worker.js'},
      'firefox:background': {scripts: ['event-page.js']},
      'safari:background': {service_worker: 'worker.js'},
      'chromium:minimum_chrome_version': '120',
      'firefox:browser_specific_settings': {
        gecko: {id: 'every-browser@example.com'}
      }
    },
    files: {
      'worker.js': 'console.log("built as a worker")\n',
      'event-page.js': 'console.log("built as an event page")\n'
    }
  })
}

// The one name that is another name spelled differently.
const FOLDER_OF: Record<string, string> = {'firefox-based': 'gecko-based'}

describe('one project built for every browser name', () => {
  const root = project()

  it.each(
    EVERY_BROWSER
  )('builds $browser into its own folder with its own manifest keys', async ({
    browser,
    family
  }) => {
    const summary = await buildProject(root, {browser})
    const dist = path.join(root, 'dist', FOLDER_OF[browser] ?? browser)
    const manifest = JSON.parse(
      fs.readFileSync(path.join(dist, 'manifest.json'), 'utf8')
    )
    const emitted = (file: unknown) =>
      fs.readFileSync(path.join(dist, String(file)), 'utf8')

    expect(summary.output_path).toBe(dist)
    expect(summary.errors_count).toBe(0)

    // No key keeps its browser prefix, whichever browser it was for.
    expect(Object.keys(manifest).filter((key) => key.includes(':'))).toEqual([])

    if (family === 'gecko') {
      expect(emitted(manifest.background.scripts[0])).toContain(
        'built as an event page'
      )

      expect(manifest.background.service_worker).toBeUndefined()
      expect(manifest.browser_specific_settings.gecko.id).toBe(
        'every-browser@example.com'
      )

      expect(manifest.minimum_chrome_version).toBeUndefined()

      return
    }

    // Safari takes the Chromium keys and runs the worker as a script list.
    const worker =
      family === 'webkit'
        ? manifest.background.scripts[0]
        : manifest.background.service_worker

    expect(emitted(worker)).toContain('built as a worker')
    expect(manifest.browser_specific_settings).toBeUndefined()
    // Chrome's version floor reaches Safari with the family keys and is
    // left out there, since it means nothing to Safari.
    expect(manifest.minimum_chrome_version).toBe(
      family === 'webkit' ? undefined : '120'
    )
  })

  it('covers exactly the names a build accepts', async () => {
    // @ts-expect-error an unknown browser proves the build refuses it
    const refusal = await buildProject(root, {browser: 'netscape'}).catch(
      (error: Error) => error
    )
    const listed = String((refusal as Error).message)
      .split('Choose one of: ')[1]
      .replace(/\.$/, '')
      .split(', ')

    expect(listed.sort()).toEqual(
      EVERY_BROWSER.map(({browser}) => browser).sort()
    )
  })
})
