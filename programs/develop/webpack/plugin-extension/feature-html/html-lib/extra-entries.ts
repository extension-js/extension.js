// ██╗  ██╗████████╗███╗   ███╗██╗
// ██║  ██║╚══██╔══╝████╗ ████║██║
// ███████║   ██║   ██╔████╔██║██║
// ██╔══██║   ██║   ██║╚██╔╝██║██║
// ██║  ██║   ██║   ██║ ╚═╝ ██║███████╗
// ╚═╝  ╚═╝   ╚═╝   ╚═╝     ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as fs from 'fs'
import * as path from 'path'
import {findNearestPackageJsonSync} from '../../../webpack-lib/package-json'
import {type DevOptions, type FilepathList} from '../../../webpack-types'

type Candidate = {
  key: string
  prop?: string
  entry: string
}

const candidates: Candidate[] = [
  {key: 'side_panel', prop: 'default_path', entry: 'sidebar/index'},
  {key: 'sidebar_action', prop: 'default_panel', entry: 'sidebar/index'},
  {key: 'action', prop: 'default_popup', entry: 'action/index'},
  {key: 'page_action', prop: 'default_popup', entry: 'action/index'},
  {key: 'browser_action', prop: 'default_popup', entry: 'action/index'},
  {key: 'options_ui', prop: 'page', entry: 'options/index'},
  {key: 'options_page', entry: 'options/index'},
  {key: 'devtools_page', entry: 'devtools/index'},
  {key: 'background', prop: 'page', entry: 'background/index'},
  {
    key: 'chrome_url_overrides',
    prop: 'newtab',
    entry: 'chrome_url_overrides/newtab'
  },
  {
    key: 'chrome_url_overrides',
    prop: 'bookmarks',
    entry: 'chrome_url_overrides/bookmarks'
  },
  {
    key: 'chrome_url_overrides',
    prop: 'history',
    entry: 'chrome_url_overrides/history'
  }
]

const isRemoteUrl = (input: string) => /^([a-z][a-z0-9+.-]*:)?\/\//i.test(input)

const isPublicRef = (raw: string) => /^(?:\/.+|(?:\.\/)?public\/)/i.test(raw)

const getBrowserPrefixes = (browser: DevOptions['browser']) => {
  const normalized = String(browser || '').toLowerCase()
  if (normalized === 'edge') return ['edge']
  if (normalized === 'firefox' || normalized === 'gecko-based')
    return ['firefox']
  if (normalized === 'chromium' || normalized === 'chromium-based') {
    return ['chromium', 'chrome']
  }
  return ['chrome']
}

const resolveManifestPath = (manifestPath: string, raw: string) => {
  if (!raw || isRemoteUrl(raw)) return undefined
  if (path.isAbsolute(raw)) return raw
  if (raw.startsWith('/')) {
    // Public-root references are skipped; treat as non-entry
    return undefined
  }
  return path.resolve(path.dirname(manifestPath), raw)
}

const isUnderPublicRoot = (manifestPath: string, resolvedPath: string) => {
  const manifestDir = path.dirname(manifestPath)
  const packageJsonPath = findNearestPackageJsonSync(manifestPath)
  const projectRoot = packageJsonPath
    ? path.dirname(packageJsonPath)
    : manifestDir
  const publicRoot = path.join(projectRoot, 'public')
  const rel = path.relative(publicRoot, resolvedPath)
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel)
}

export function getExtraHtmlEntries(params: {
  manifestPath: string
  browser: DevOptions['browser']
}): FilepathList {
  const {manifestPath, browser} = params
  try {
    const manifestDir = path.dirname(manifestPath)
    const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
    const prefixes = getBrowserPrefixes(browser)

    const entries: FilepathList = {}
    for (const {key, prop, entry} of candidates) {
      const direct = raw?.[key]
      const directValue =
        prop && direct ? direct[prop] : !prop ? direct : undefined
      if (typeof directValue === 'string') {
        if (!isPublicRef(directValue)) {
          const resolved = resolveManifestPath(manifestPath, directValue)
          if (resolved && fs.existsSync(resolved)) {
            if (!isUnderPublicRoot(manifestPath, resolved)) {
              entries[entry] = resolved
            }
          }
        }
      }

      for (const prefix of prefixes) {
        const prefixed = raw?.[`${prefix}:${key}`]
        const prefixedValue =
          prop && prefixed ? prefixed[prop] : !prop ? prefixed : undefined
        if (typeof prefixedValue === 'string') {
          if (!isPublicRef(prefixedValue)) {
            const resolved = resolveManifestPath(manifestPath, prefixedValue)
            if (resolved && fs.existsSync(resolved)) {
              if (!isUnderPublicRoot(manifestPath, resolved)) {
                entries[entry] = resolved
              }
            }
          }
        }
      }
    }

    return entries
  } catch {
    return {}
  }
}
