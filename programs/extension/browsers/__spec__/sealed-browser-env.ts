import * as fs from 'node:fs'
import * as path from 'node:path'
import {expect} from 'vitest'

// Every variable a locator or the launchers read to find a browser.
const LOCATION_VARIABLES = [
  'HOME',
  'USERPROFILE',
  'LOCALAPPDATA',
  'APPDATA',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'PROGRAMW6432',
  'EXT_BROWSERS_CACHE_DIR',
  'PLAYWRIGHT_BROWSERS_PATH',
  'PUPPETEER_CACHE_DIR',
  'PUPPETEER_EXECUTABLE_PATH',
  'CHROME_FOR_TESTING_PATH',
  'CHROME_PATH',
  'CHROME_BINARY',
  'CHROMIUM_BINARY',
  'EDGE_BINARY',
  'FIREFOX_BINARY'
]

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, path.resolve(target))

  return !relative.startsWith('..') && !path.isAbsolute(relative)
}

export function emptyPathFolder(root: string): string {
  const folder = path.join(root, 'empty-path')
  fs.mkdirSync(folder, {recursive: true})

  return folder
}

// These specs swap the env for one without the test-runner marker, so a lost
// locator mock must still find nothing: no PATH entry, no folder off the root.
export function expectSealedBrowserEnv(
  root: string,
  env: Record<string, string | undefined> = process.env
) {
  const search = Object.keys(env).filter((key) => key.toUpperCase() === 'PATH')
  expect(search).toHaveLength(1)

  const folders = String(env[search[0]]).split(path.delimiter)
  expect(folders).toHaveLength(1)
  expect(isInside(root, folders[0])).toBe(true)
  expect(fs.readdirSync(folders[0])).toEqual([])

  const outside = Object.keys(env).filter(
    (key) =>
      LOCATION_VARIABLES.includes(key.toUpperCase()) &&
      !isInside(root, String(env[key]))
  )
  expect(outside).toEqual([])
}
