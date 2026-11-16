#!/usr/bin/env node

import {spawn, spawnSync} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {DATA_FILE} from './generate-enum-types.mjs'
import {resolveRepoCli} from './lib/resolve-dev-cli.mjs'

// Every permission and manifest key that brings an API namespace in. One
// the browser does not know only warns, so the list can run ahead of it.
const PERMISSIONS = [
  'accessibilityFeatures.read',
  'activeTab',
  'alarms',
  'audio',
  'bookmarks',
  'browsingData',
  'certificateProvider',
  'clipboardRead',
  'clipboardWrite',
  'contentSettings',
  'contextMenus',
  'cookies',
  'debugger',
  'declarativeContent',
  'declarativeNetRequest',
  'declarativeNetRequestFeedback',
  'desktopCapture',
  'dns',
  'documentScan',
  'downloads',
  'downloads.ui',
  'enterprise.deviceAttributes',
  'enterprise.hardwarePlatform',
  'enterprise.networkingAttributes',
  'enterprise.platformKeys',
  'favicon',
  'fileBrowserHandler',
  'fileSystemProvider',
  'fontSettings',
  'gcm',
  'geolocation',
  'history',
  'identity',
  'idle',
  'loginState',
  'management',
  'nativeMessaging',
  'notifications',
  'offscreen',
  'pageCapture',
  'platformKeys',
  'power',
  'printerProvider',
  'printing',
  'printingMetrics',
  'privacy',
  'processes',
  'proxy',
  'readingList',
  'scripting',
  'search',
  'sessions',
  'sidePanel',
  'storage',
  'system.cpu',
  'system.display',
  'system.memory',
  'system.storage',
  'tabCapture',
  'tabGroups',
  'tabs',
  'topSites',
  'tts',
  'ttsEngine',
  'unlimitedStorage',
  'userScripts',
  'vpnProvider',
  'wallpaper',
  'webAuthenticationProxy',
  'webNavigation',
  'webRequest',
  'webRequestAuthProvider'
]

const MANIFEST = {
  manifest_version: 3,
  name: 'Enum objects probe',
  version: '1.0.0',
  action: {},
  omnibox: {keyword: 'probe'},
  background: {service_worker: 'background.js'},
  host_permissions: ['<all_urls>'],
  permissions: PERMISSIONS
}

// Runs in the service worker: every object under chrome that holds only
// strings is an enum object, and the result waits in storage for the read.
const PROBE = `
const objects = {}
const seen = new Set()

function walk(value, trail, depth) {
  if (depth > 4 || !value || seen.has(value)) return

  seen.add(value)

  let keys = []

  try {
    keys = Object.keys(value)
  } catch {
    return
  }

  for (const key of keys) {
    let child

    try {
      child = value[key]
    } catch {
      continue
    }

    if (!child || typeof child !== 'object' || Array.isArray(child)) continue

    const entries = Object.entries(child)

    if (entries.length && entries.every((entry) => typeof entry[1] === 'string')) {
      objects[trail.concat(key).join('.')] = Object.fromEntries(entries)
    } else {
      walk(child, trail.concat(key), depth + 1)
    }
  }
}

walk(chrome, [], 0)
chrome.storage.local.set({probe: {userAgent: navigator.userAgent, objects}})
`

function sorted(record) {
  return Object.fromEntries(
    Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  )
}

// The file the generator reads: which enum objects the browser has, with
// the keys and values it gave, in a stable order.
export function enumObjectsData(probe) {
  const version = probe.userAgent.match(/Chrome\/(\d+)/)
  const objects = {}

  for (const [name, entries] of Object.entries(sorted(probe.objects))) {
    objects[name] = sorted(entries)
  }

  return {browser: `Chrome ${version ? version[1] : 'unknown'}`, objects}
}

function readProbe(cliPath, project) {
  const result = spawnSync(
    process.execPath,
    [
      cliPath,
      'storage',
      'get',
      '--key',
      'probe',
      '--browser',
      'chrome',
      '--timeout',
      '20000',
      '--output',
      'json'
    ],
    {cwd: project, encoding: 'utf8'}
  )

  try {
    return JSON.parse(result.stdout).value?.probe
  } catch {
    return undefined
  }
}

async function main() {
  const {cliPath} = resolveRepoCli()
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'enum-objects-'))
  // The managed Chrome with its throwaway profile, and no window.
  const env = {...process.env, EXTENSION_BROWSER_FLAGS: '--headless=new'}

  fs.writeFileSync(
    path.join(project, 'manifest.json'),
    JSON.stringify(MANIFEST, null, 2)
  )

  fs.writeFileSync(path.join(project, 'background.js'), PROBE)
  fs.writeFileSync(
    path.join(project, 'package.json'),
    JSON.stringify({name: 'enum-objects-probe', private: true})
  )

  const built = spawnSync(
    process.execPath,
    [cliPath, 'build', '--browser', 'chrome'],
    {cwd: project, env, stdio: 'ignore'}
  )

  if (built.status !== 0) throw new Error('The probe did not build.')

  const session = spawn(
    process.execPath,
    [
      cliPath,
      'preview',
      '--browser',
      'chrome',
      '--port',
      '0',
      '--allow-control'
    ],
    {cwd: project, env, stdio: 'ignore'}
  )
  const closed = new Promise((resolve) => session.once('close', resolve))

  try {
    let probe

    for (let attempt = 0; attempt < 60 && !probe; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
      probe = readProbe(cliPath, project)
    }

    if (!probe) throw new Error('The probe did not answer within 60 seconds.')

    const data = enumObjectsData(probe)

    fs.writeFileSync(DATA_FILE, `${JSON.stringify(data, null, 2)}\n`)

    console.log(
      `${Object.keys(data.objects).length} enum objects read from ${data.browser}. Now run node scripts/generate-enum-types.mjs`
    )
  } finally {
    session.kill('SIGINT')
    await closed
    fs.rmSync(project, {recursive: true, force: true})
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main()
}
