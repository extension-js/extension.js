//  ██╗███╗   ██╗███████╗████████╗ █████╗ ██╗     ██╗
//  ██║████╗  ██║██╔════╝╚══██╔══╝██╔══██╗██║     ██║
//  ██║██╔██╗ ██║███████╗   ██║   ███████║██║     ██║
//  ██║██║╚██╗██║╚════██║   ██║   ██╔══██║██║     ██║
//  ██║██║ ╚████║███████║   ██║   ██║  ██║███████╗███████╗
//  ╚═╝╚═╝  ╚═══╝╚══════╝   ╚═╝   ╚═╝  ╚═╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import fs from 'node:fs'
import path from 'node:path'
import type {InstallBrowserTarget} from './browser-target'

export const INSTALL_MARKER_FILE = '.extension-install.json'

export type FolderOwner = 'absent' | 'ours' | 'foreign'

// The folder @puppeteer/browsers names after a platform and a build, such as
// mac_arm-131.0.6778.85, linux-1380000 or win64-stable_133.0.
const BUILD_FOLDER =
  /^(?:linux|linux_arm|mac|mac_arm|win32|win64)-[0-9A-Za-z][0-9A-Za-z._-]*$/

const EDGE_BUILD_FOLDER = /^msedge(?:-[0-9A-Za-z][0-9A-Za-z._-]*)?$/

// What Playwright leaves beside a browser: its links folder and its own lock.
const INSTALLER_RESIDUE = new Set(['.links', '__dirlock'])

// @puppeteer/browsers nests each download under a folder named after it.
const NESTED_FOLDERS: Record<InstallBrowserTarget, string[]> = {
  chrome: ['chrome'],
  chromium: ['chromium', 'chrome'],
  firefox: ['firefox'],
  edge: []
}

// A browser profile beside the marker means the folder became someone's data
// after the install, so the marker alone no longer speaks for it.
const PROFILE_SIGNS = new Set([
  'default',
  'local state',
  'first run',
  'profiles',
  'profiles.ini',
  'installs.ini'
])

function isBuildFolder(entry: fs.Dirent, browser: InstallBrowserTarget) {
  if (!entry.isDirectory()) return false
  if (BUILD_FOLDER.test(entry.name)) return true

  return browser === 'edge' && EDGE_BUILD_FOLDER.test(entry.name)
}

function isNestedInstall(dir: string, browser: InstallBrowserTarget): boolean {
  try {
    return fs
      .readdirSync(dir, {withFileTypes: true})
      .every(
        (entry) =>
          (entry.name === '.metadata' && entry.isFile()) ||
          isBuildFolder(entry, browser)
      )
  } catch {
    return false
  }
}

function isInstallerEntry(
  dir: string,
  entry: fs.Dirent,
  browser: InstallBrowserTarget
): boolean {
  if (entry.name === INSTALL_MARKER_FILE) return entry.isFile()
  if (entry.name === '.metadata') return entry.isFile()
  if (INSTALLER_RESIDUE.has(entry.name)) return entry.isDirectory()
  if (isBuildFolder(entry, browser)) return true

  return (
    entry.isDirectory() &&
    NESTED_FOLDERS[browser].includes(entry.name) &&
    isNestedInstall(path.join(dir, entry.name), browser)
  )
}

function readEntries(dir: string): fs.Dirent[] | null {
  try {
    if (!fs.lstatSync(dir).isDirectory()) return null

    return fs.readdirSync(dir, {withFileTypes: true})
  } catch {
    return null
  }
}

// Asked before every recursive delete. A folder is ours when it is empty,
// carries the marker, or holds only what the installers write.
export function folderOwner(
  dir: string,
  browser: InstallBrowserTarget
): FolderOwner {
  try {
    fs.lstatSync(dir)
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
      ? 'absent'
      : 'foreign'
  }

  // A file or a link at the path is nothing an install made.
  const entries = readEntries(dir)
  if (!entries) return 'foreign'

  const marked = entries.some(
    (entry) => entry.name === INSTALL_MARKER_FILE && entry.isFile()
  )

  if (marked) {
    return entries.some((entry) => PROFILE_SIGNS.has(entry.name.toLowerCase()))
      ? 'foreign'
      : 'ours'
  }

  return entries.every((entry) => isInstallerEntry(dir, entry, browser))
    ? 'ours'
    : 'foreign'
}

// True when nothing in the folder could be a browser: only the marker and
// the installer's own bookkeeping, or nothing at all.
export function holdsNoBrowser(dir: string): boolean {
  const entries = readEntries(dir)

  return Boolean(
    entries?.every(
      (entry) =>
        entry.name === INSTALL_MARKER_FILE || INSTALLER_RESIDUE.has(entry.name)
    )
  )
}

export function holdsOnlyMarker(dir: string): boolean {
  const entries = readEntries(dir)

  return Boolean(entries?.every((entry) => entry.name === INSTALL_MARKER_FILE))
}

// Written before the installer starts, so a tree a killed run leaves behind
// is still known as ours on the next run.
export function writeInstallMarker(
  dir: string,
  browser: InstallBrowserTarget,
  now: number = Date.now()
): void {
  fs.mkdirSync(dir, {recursive: true})
  fs.writeFileSync(
    path.join(dir, INSTALL_MARKER_FILE),
    `${JSON.stringify({
      owner: 'extension-install',
      browser,
      attemptedAt: new Date(now).toISOString()
    })}\n`
  )
}

// Takes away a folder that holds the marker and nothing else, without a
// recursive delete. Anything else in it makes the rmdir fail and stay.
export function removeMarkerOnlyFolder(dir: string): void {
  fs.rmSync(path.join(dir, INSTALL_MARKER_FILE), {force: true})
  fs.rmdirSync(dir)
}
