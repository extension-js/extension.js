import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterAll, beforeEach, describe, expect, it} from 'vitest'
import type {InstallBrowserTarget} from '../lib/browser-target'
import {
  folderOwner,
  holdsNoBrowser,
  holdsOnlyMarker,
  INSTALL_MARKER_FILE,
  removeMarkerOnlyFolder,
  writeInstallMarker
} from '../lib/folder-owner'

// Every folder judged here is made under this one temp folder.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-folder-owner-'))

afterAll(() => {
  fs.rmSync(scratch, {recursive: true, force: true})
})

describe('folderOwner, asked before any recursive delete', () => {
  let dir = ''

  beforeEach(() => {
    dir = path.join(fs.mkdtempSync(path.join(scratch, 'root-')), 'browser')
  })

  // A trailing slash makes a folder, anything else a file.
  function plant(...entries: string[]) {
    fs.mkdirSync(dir, {recursive: true})

    for (const entry of entries) {
      const target = path.join(dir, entry)

      if (entry.endsWith('/')) {
        fs.mkdirSync(target, {recursive: true})
      } else {
        fs.mkdirSync(path.dirname(target), {recursive: true})
        fs.writeFileSync(target, 'x')
      }
    }
  }

  it('answers absent for a path that is not there', () => {
    expect(folderOwner(dir, 'chrome')).toBe('absent')
  })

  it('takes an empty folder as ours', () => {
    plant()

    expect(folderOwner(dir, 'chrome')).toBe('ours')
  })

  it.each<{name: string; browser: InstallBrowserTarget; entries: string[]}>([
    {
      name: 'the folder @puppeteer/browsers nests, with its metadata',
      browser: 'chrome',
      entries: [
        'chrome/.metadata',
        'chrome/mac_arm-131.0.6778.85/chrome-mac-arm64/chrome',
        'chrome/mac_arm-151.0.7922.34/'
      ]
    },
    {
      name: 'a Firefox channel build',
      browser: 'firefox',
      entries: ['firefox/.metadata', 'firefox/mac_arm-stable_133.0/Firefox']
    },
    {
      name: 'a Chromium revision, nested under either name',
      browser: 'chromium',
      entries: ['chromium/linux-1380000/chrome', 'chrome/win64-1380000/']
    },
    {
      name: 'build folders at the top, as older installs left them',
      browser: 'chrome',
      entries: [
        'linux-152.0.9999.1/chrome',
        'linux_arm-152.0.9999.1/',
        '.metadata'
      ]
    },
    {
      name: 'what Playwright leaves for Edge',
      browser: 'edge',
      entries: ['.links/be96a6f53e7c32e028ee0097338cb0204e28ef43', '__dirlock/']
    },
    {
      name: 'an Edge the launcher reads from the Playwright folder',
      browser: 'edge',
      entries: ['msedge-1140/msedge', 'msedge/', '.links/']
    },
    {
      name: 'the marker beside files no rule names',
      browser: 'chrome',
      entries: [INSTALL_MARKER_FILE, '131.0.6778.85-chrome-mac-arm64.zip']
    }
  ])('takes $name as ours', ({browser, entries}) => {
    plant(...entries)

    expect(folderOwner(dir, browser)).toBe('ours')
  })

  it.each<{name: string; browser: InstallBrowserTarget; entries: string[]}>([
    {
      name: 'a Chrome profile',
      browser: 'chrome',
      entries: ['Default/Preferences', 'Local State']
    },
    {
      name: 'a Firefox profile folder',
      browser: 'firefox',
      entries: ['Profiles/abc.default/prefs.js', 'profiles.ini']
    },
    {
      name: 'one stray file beside a real install',
      browser: 'chrome',
      entries: ['chrome/mac_arm-131.0.6778.85/', 'notes.txt']
    },
    {
      name: 'a stray file inside the nested folder',
      browser: 'chrome',
      entries: ['chrome/mac_arm-131.0.6778.85/', 'chrome/notes.txt']
    },
    {
      name: 'a build folder name that is a file',
      browser: 'chrome',
      entries: ['mac_arm-131.0.6778.85']
    },
    {
      name: 'a folder named like a platform with no build',
      browser: 'chrome',
      entries: ['linux/']
    },
    {
      name: 'a platform no installer writes',
      browser: 'chrome',
      entries: ['solaris-131.0.6778.85/']
    },
    {
      name: 'another browser nested in it',
      browser: 'chrome',
      entries: ['firefox/mac_arm-stable_133.0/']
    },
    {
      name: 'an Edge build folder under a browser that is not Edge',
      browser: 'chrome',
      entries: ['msedge-1140/']
    },
    {
      name: 'a links folder that is a file',
      browser: 'edge',
      entries: ['.links']
    },
    {
      name: 'a marker that is a folder',
      browser: 'chrome',
      entries: [`${INSTALL_MARKER_FILE}/`, 'notes.txt']
    },
    {
      name: 'the marker beside a profile that appeared later',
      browser: 'chrome',
      entries: [INSTALL_MARKER_FILE, 'Default/Preferences', 'Local State']
    }
  ])('takes $name as foreign', ({browser, entries}) => {
    plant(...entries)

    expect(folderOwner(dir, browser)).toBe('foreign')
  })

  it('takes a file at the path as foreign', () => {
    fs.mkdirSync(path.dirname(dir), {recursive: true})
    fs.writeFileSync(dir, 'not a folder')

    expect(folderOwner(dir, 'chrome')).toBe('foreign')
  })

  it.skipIf(process.platform === 'win32')(
    'takes a link as foreign, at the path and inside it',
    () => {
      const real = path.join(path.dirname(dir), 'real')
      fs.mkdirSync(path.join(real, 'mac_arm-131.0.6778.85'), {recursive: true})
      fs.symlinkSync(real, dir)

      expect(folderOwner(real, 'chrome')).toBe('ours')
      expect(folderOwner(dir, 'chrome')).toBe('foreign')

      fs.symlinkSync(real, path.join(real, 'mac_arm-151.0.7922.34'))

      expect(folderOwner(real, 'chrome')).toBe('foreign')
    }
  )

  it('writes a marker that names the browser and the time, making the folder as it goes', () => {
    writeInstallMarker(dir, 'firefox', Date.UTC(2026, 10, 16, 12))

    expect(fs.readdirSync(dir)).toEqual(['.extension-install.json'])
    expect(fs.readFileSync(path.join(dir, INSTALL_MARKER_FILE), 'utf8')).toBe(
      '{"owner":"extension-install","browser":"firefox",' +
        '"attemptedAt":"2026-11-16T12:00:00.000Z"}\n'
    )

    expect(folderOwner(dir, 'firefox')).toBe('ours')
  })

  it('tells a folder with no browser in it from one that may hold one', () => {
    plant(INSTALL_MARKER_FILE, '.links/abc', '__dirlock/')

    expect(holdsNoBrowser(dir)).toBe(true)
    expect(holdsOnlyMarker(dir)).toBe(false)

    plant('mac_arm-131.0.6778.85/')

    expect(holdsNoBrowser(dir)).toBe(false)
    expect(holdsNoBrowser(path.join(dir, 'missing'))).toBe(false)
  })

  it('removes a folder that holds the marker alone, and refuses one that holds more', () => {
    plant(INSTALL_MARKER_FILE)

    expect(holdsOnlyMarker(dir)).toBe(true)
    removeMarkerOnlyFolder(dir)
    expect(fs.existsSync(dir)).toBe(false)

    plant(INSTALL_MARKER_FILE, 'Local State')

    expect(holdsOnlyMarker(dir)).toBe(false)
    expect(() => removeMarkerOnlyFolder(dir)).toThrow(/ENOTEMPTY|EEXIST/)
    expect(fs.readdirSync(dir)).toEqual(['Local State'])
  })
})
