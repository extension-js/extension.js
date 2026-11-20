// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {isGeckoBasedBrowser, isWebkitBasedBrowser} from '../../../lib/constants'
import type {Manifest} from '../../../types'

export interface FatalShapeFix {
  field: string
  detail: string
  // The engine that refuses the load, when it is not Chrome
  refusedBy?: string
}

export interface MistypedManifestField {
  field: string
  expected: string
  received: string
}

const STRING_LIST_FIELDS = ['permissions', 'host_permissions'] as const

// The build spreads these into new objects, so a string or an array turns into
// numbered keys and the browser gets a broken manifest at exit 0.
const OBJECT_FIELDS = [
  'action',
  'browser_action',
  'page_action',
  'background',
  'side_panel',
  'sidebar_action',
  'options_ui',
  'sandbox',
  'storage',
  'theme',
  'chrome_url_overrides',
  'declarative_net_request',
  'user_scripts'
] as const

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function describeValue(value: unknown): string {
  if (Array.isArray(value)) return 'an array'
  if (value === null) return 'null'
  if (typeof value === 'object') return 'an object'
  if (typeof value === 'string') return `the string ${JSON.stringify(value)}`

  return `the ${typeof value} ${JSON.stringify(value)}`
}

// The fields the build iterates as arrays. A value of another type throws a
// TypeError deep inside entry discovery, so these are checked up front.
export function findMistypedManifestFields(
  manifest: Manifest
): MistypedManifestField[] {
  const source = manifest as Record<string, unknown>
  const mistyped: MistypedManifestField[] = []

  const expectArray = (field: string, value: unknown, expected: string) => {
    if (value === undefined || Array.isArray(value)) return

    mistyped.push({field, expected, received: describeValue(value)})
  }

  // Each path the build resolves goes through a string replace, so a number,
  // a nested array or an object in a path slot would throw a raw TypeError.
  const expectPath = (field: string, value: unknown) => {
    if (value === undefined || typeof value === 'string') return

    mistyped.push({
      field,
      expected: 'a file path string',
      received: describeValue(value)
    })
  }

  const expectPathList = (field: string, value: unknown, expected: string) => {
    expectArray(field, value, expected)

    if (!Array.isArray(value)) return

    value.forEach((entry, index) => {
      expectPath(`${field}[${index}]`, entry)
    })
  }

  const expectPathMap = (field: string, value: unknown) => {
    if (!isPlainObject(value)) return

    for (const [key, entry] of Object.entries(value)) {
      expectPath(`${field}.${key}`, entry)
    }
  }

  const expectIconSet = (field: string, value: unknown) => {
    if (value === undefined || typeof value === 'string') return

    if (isPlainObject(value)) {
      expectPathMap(field, value)

      return
    }

    mistyped.push({
      field,
      expected: 'a file path string or an object of sizes to paths',
      received: describeValue(value)
    })
  }

  for (const field of OBJECT_FIELDS) {
    const value = source[field]

    if (value === undefined || isPlainObject(value)) continue

    mistyped.push({
      field,
      expected: 'an object',
      received: describeValue(value)
    })
  }

  const contentScripts = source.content_scripts
  expectArray(
    'content_scripts',
    contentScripts,
    'an array of content script objects'
  )

  if (Array.isArray(contentScripts)) {
    contentScripts.forEach((entry, index) => {
      if (!isPlainObject(entry)) {
        mistyped.push({
          field: `content_scripts[${index}]`,
          expected: 'a content script object',
          received: describeValue(entry)
        })

        return
      }

      expectPathList(
        `content_scripts[${index}].js`,
        entry.js,
        'an array of script paths'
      )

      expectPathList(
        `content_scripts[${index}].css`,
        entry.css,
        'an array of stylesheet paths'
      )
    })
  }

  if (isPlainObject(source.sandbox)) {
    expectPathList(
      'sandbox.pages',
      source.sandbox.pages,
      'an array of page paths'
    )
  }

  if (isPlainObject(source.background)) {
    expectPathList(
      'background.scripts',
      source.background.scripts,
      'an array of script paths'
    )

    expectPath('background.service_worker', source.background.service_worker)
    expectPath('background.page', source.background.page)
  }

  expectPath('options_page', source.options_page)
  expectPath('devtools_page', source.devtools_page)

  if (source.icons !== undefined && !isPlainObject(source.icons)) {
    mistyped.push({
      field: 'icons',
      expected: 'an object of sizes to paths',
      received: describeValue(source.icons)
    })
  }

  expectPathMap('icons', source.icons)

  const pageSlots: Array<[string, string]> = [
    ['action', 'default_popup'],
    ['browser_action', 'default_popup'],
    ['page_action', 'default_popup'],
    ['options_ui', 'page'],
    ['side_panel', 'default_path'],
    ['sidebar_action', 'default_panel'],
    ['storage', 'managed_schema'],
    ['user_scripts', 'api_script']
  ]

  for (const [owner, key] of pageSlots) {
    const value = source[owner]

    if (isPlainObject(value)) expectPath(`${owner}.${key}`, value[key])
  }

  for (const owner of [
    'action',
    'browser_action',
    'page_action',
    'sidebar_action'
  ]) {
    const value = source[owner]

    if (isPlainObject(value)) {
      expectIconSet(`${owner}.default_icon`, value.default_icon)
    }
  }

  expectPathMap('chrome_url_overrides', source.chrome_url_overrides)

  if (
    isPlainObject(source.browser_action) &&
    Array.isArray(source.browser_action.theme_icons)
  ) {
    source.browser_action.theme_icons.forEach((icon, index) => {
      const field = `browser_action.theme_icons[${index}]`

      if (!isPlainObject(icon)) {
        mistyped.push({
          field,
          expected: 'an object with light and dark icon paths',
          received: describeValue(icon)
        })

        return
      }

      expectPath(`${field}.light`, icon.light)
      expectPath(`${field}.dark`, icon.dark)
    })
  }

  if (
    isPlainObject(source.declarative_net_request) &&
    Array.isArray(source.declarative_net_request.rule_resources)
  ) {
    source.declarative_net_request.rule_resources.forEach((rule, index) => {
      const field = `declarative_net_request.rule_resources[${index}]`

      if (!isPlainObject(rule)) {
        mistyped.push({
          field,
          expected: 'a rule resource object',
          received: describeValue(rule)
        })

        return
      }

      expectPath(`${field}.path`, rule.path)
    })
  }

  const resources = source.web_accessible_resources
  expectArray(
    'web_accessible_resources',
    resources,
    'an array of resource entries'
  )

  if (Array.isArray(resources)) {
    resources.forEach((entry, index) => {
      const field = `web_accessible_resources[${index}]`

      if (typeof entry === 'string') return

      if (!isPlainObject(entry)) {
        mistyped.push({
          field,
          expected: 'a path string or an object with a resources array',
          received: describeValue(entry)
        })

        return
      }

      expectPathList(
        `${field}.resources`,
        entry.resources,
        'an array of resource paths'
      )
    })
  }

  for (const field of STRING_LIST_FIELDS) {
    if (typeof source[field] === 'string') continue

    expectArray(field, source[field], 'an array of strings')
  }

  return mistyped
}

// Firefox takes a positive integer with no leading zero as an icon size, and
// Chrome any positive integer. Safari was not measured, so its build is kept.
function isRefusedIconSize(size: string, browser?: string): boolean {
  if (isWebkitBasedBrowser(String(browser))) return false
  if (isGeckoBasedBrowser(String(browser))) return !/^[1-9]\d*$/.test(size)

  return !/^\d+$/.test(size) || Number(size) === 0
}

function dropRefusedIconSizes(
  owner: Record<string, unknown>,
  key: string,
  field: string,
  browser: string | undefined,
  fixes: FatalShapeFix[]
): void {
  const map = owner[key]

  if (!isPlainObject(map)) return

  const engine = isGeckoBasedBrowser(String(browser)) ? 'Firefox' : 'Chrome'
  let dropped = false

  for (const [size, ref] of Object.entries(map)) {
    if (!isRefusedIconSize(size, browser)) continue

    delete map[size]
    dropped = true
    fixes.push({
      field: `${field}.${size}`,
      detail: `removed ${JSON.stringify(size)}: ${JSON.stringify(ref)}, ${engine} takes only a whole pixel size such as "48" as the key and refuses the whole extension over any other`,
      refusedBy: engine
    })
  }

  if (dropped && Object.keys(map).length === 0) delete owner[key]
}

export function sanitizeFatalManifestShapes(
  manifest: Manifest,
  manifestDir?: string,
  browser?: string
): {
  manifest: Manifest
  fixes: FatalShapeFix[]
} {
  const out = manifest as Record<string, unknown>
  const fixes: FatalShapeFix[] = []
  const isChromiumTarget =
    !isGeckoBasedBrowser(String(browser)) &&
    !isWebkitBasedBrowser(String(browser))

  // Chrome fails the load over this key under Manifest V3, even when false.
  // Firefox loads the same manifest, so only a Chromium build loses the key.
  if (
    isChromiumTarget &&
    Number(out.manifest_version) === 3 &&
    isPlainObject(out.options_ui) &&
    'chrome_style' in out.options_ui
  ) {
    const from = out.options_ui.chrome_style
    delete out.options_ui.chrome_style
    fixes.push({
      field: 'options_ui.chrome_style',
      detail: `removed chrome_style: ${JSON.stringify(from)}, Chrome refuses the whole extension over this key under Manifest V3, whatever its value`
    })
  }

  dropRefusedIconSizes(out, 'icons', 'icons', browser, fixes)

  for (const actionKey of ['action', 'browser_action', 'page_action']) {
    const action = out[actionKey]

    if (!isPlainObject(action)) continue

    dropRefusedIconSizes(
      action,
      'default_icon',
      `${actionKey}.default_icon`,
      browser,
      fixes
    )
  }

  if (typeof out.name !== 'string' || out.name === '') {
    const from = out.name
    const isScalar = typeof from === 'number' || typeof from === 'boolean'
    out.name = isScalar ? String(from) : 'Unnamed Extension'
    fixes.push({
      field: 'name',
      detail: `replaced ${JSON.stringify(from)} with "${out.name}", Chrome requires a non-empty string name and refuses the whole extension otherwise`
    })
  }

  if (out.version == null) {
    out.version = '0.0.0'
    fixes.push({
      field: 'version',
      detail:
        'added "0.0.0", the required version key was missing and Chrome refuses the whole extension without it'
    })
  }

  if (out.version != null && typeof out.version !== 'string') {
    const from = JSON.stringify(out.version)
    out.version = String(out.version)
    fixes.push({
      field: 'version',
      detail: `coerced ${from} (${typeof JSON.parse(from)}) to the string "${out.version}", Chrome rejects a non-string version`
    })
  }

  if (
    typeof out.version === 'string' &&
    !isValidChromeVersion(out.version.trim())
  ) {
    const from = out.version
    out.version = salvageVersion(out.version)
    fixes.push({
      field: 'version',
      detail: `replaced "${from}" with "${out.version}", Chrome requires 1-4 dot-separated integers (0-65535) and refuses the whole extension otherwise`
    })
  }

  for (const actionKey of ['action', 'browser_action', 'page_action']) {
    const action = out[actionKey]

    if (!action || typeof action !== 'object' || Array.isArray(action)) {
      continue
    }

    const actionObj = action as Record<string, unknown>
    const icon = actionObj.default_icon
    const isEmptyString = icon === ''
    const isEmptyObject =
      icon !== null &&
      typeof icon === 'object' &&
      !Array.isArray(icon) &&
      Object.keys(icon).length === 0

    if (isEmptyString || isEmptyObject) {
      delete actionObj.default_icon
      fixes.push({
        field: `${actionKey}.default_icon`,
        detail:
          'removed the empty default_icon, Chrome rejects the whole extension over it'
      })
    }
  }

  if (manifestDir) {
    const emptyIconDetail = (ref: string) =>
      `removed "${ref}". The file is empty (0 bytes) and Chrome refuses the whole extension over an icon it cannot load`

    const isEmptyIconFile = (ref: unknown): ref is string => {
      if (typeof ref !== 'string' || ref.trim() === '') return false

      try {
        const abs = path.join(manifestDir, ref.replace(/^\//, ''))

        return fs.existsSync(abs) && fs.statSync(abs).size === 0
      } catch {
        return false
      }
    }

    const icons = out.icons

    if (icons && typeof icons === 'object' && !Array.isArray(icons)) {
      const iconsObj = icons as Record<string, unknown>
      let dropped = false

      for (const [size, ref] of Object.entries(iconsObj)) {
        if (isEmptyIconFile(ref)) {
          delete iconsObj[size]
          dropped = true
          fixes.push({field: `icons.${size}`, detail: emptyIconDetail(ref)})
        }
      }

      if (dropped && Object.keys(iconsObj).length === 0) delete out.icons
    }

    for (const actionKey of ['action', 'browser_action', 'page_action']) {
      const action = out[actionKey]

      if (!action || typeof action !== 'object' || Array.isArray(action)) {
        continue
      }

      const actionObj = action as Record<string, unknown>
      const icon = actionObj.default_icon

      if (isEmptyIconFile(icon)) {
        delete actionObj.default_icon
        fixes.push({
          field: `${actionKey}.default_icon`,
          detail: emptyIconDetail(icon)
        })
      } else if (icon && typeof icon === 'object' && !Array.isArray(icon)) {
        let dropped = false
        const iconMap = icon as Record<string, unknown>

        for (const [size, ref] of Object.entries(iconMap)) {
          if (isEmptyIconFile(ref)) {
            delete iconMap[size]
            dropped = true
            fixes.push({
              field: `${actionKey}.default_icon.${size}`,
              detail: emptyIconDetail(ref)
            })
          }
        }

        if (dropped && Object.keys(iconMap).length === 0) {
          delete actionObj.default_icon
        }
      }
    }
  }

  const csp = out.content_security_policy as
    | Record<string, unknown>
    | null
    | undefined

  if (
    csp &&
    typeof csp === 'object' &&
    !Array.isArray(csp) &&
    typeof csp.extension_pages === 'string'
  ) {
    const stripped = stripUnsafeInlineFromScriptSrc(csp.extension_pages)

    if (stripped !== csp.extension_pages) {
      csp.extension_pages = stripped
      fixes.push({
        field: 'content_security_policy.extension_pages',
        detail:
          "removed 'unsafe-inline' from script-src, Chrome refuses the whole extension over an insecure CSP value in extension pages"
      })
    }
  }

  for (const field of STRING_LIST_FIELDS) {
    const value = out[field]

    if (typeof value !== 'string') continue

    out[field] = [value]
    fixes.push({
      field,
      detail: `wrapped the string ${JSON.stringify(value)} in an array, Chrome requires a list of strings here and refuses the whole extension otherwise`
    })
  }

  const commands = out.commands

  if (commands && typeof commands === 'object' && !Array.isArray(commands)) {
    for (const [name, command] of Object.entries(commands)) {
      // `_execute_action` and friends are the only commands Chrome allows
      // to omit the description.
      if (name.startsWith('_execute_')) continue

      if (!command || typeof command !== 'object' || Array.isArray(command)) {
        continue
      }

      const entry = command as Record<string, unknown>

      if (typeof entry.description === 'string' && entry.description.trim()) {
        continue
      }

      const from = entry.description
      entry.description = name
      fixes.push({
        field: `commands.${name}.description`,
        detail: `replaced ${JSON.stringify(from)} with "${name}", Chrome requires a non-empty string description on named commands and refuses the whole extension otherwise`
      })
    }
  }

  return {manifest: out as Manifest, fixes}
}

// Drop 'unsafe-inline' from script-src only; a script-src left empty would
// mean "allow nothing", so it falls back to 'self'.
function stripUnsafeInlineFromScriptSrc(policy: string): string {
  let changed = false
  const rebuilt = policy
    .split(';')
    .map((segment) => {
      const tokens = segment.trim().split(/\s+/).filter(Boolean)
      if (tokens.length === 0) return null
      if (tokens[0].toLowerCase() !== 'script-src') return tokens.join(' ')

      const values = tokens
        .slice(1)
        .filter((value) => value.toLowerCase() !== "'unsafe-inline'")
      if (values.length !== tokens.length - 1) changed = true

      return ['script-src', ...(values.length ? values : ["'self'"])].join(' ')
    })
    .filter((segment): segment is string => segment !== null)

  return changed ? rebuilt.join('; ') : policy
}

function isValidChromeVersion(version: string): boolean {
  if (!version) return false

  const parts = version.split('.')
  if (parts.length > 4) return false

  return parts.every((part) => /^\d{1,5}$/.test(part) && Number(part) <= 65535)
}

// Salvage what numbers the author DID write ("1.0-beta" -> "1.0");
// a version with none becomes "0.0.0".
function salvageVersion(version: string): string {
  const digits = version.match(/\d{1,5}/g)?.slice(0, 4) ?? []
  if (!digits.length) return '0.0.0'

  return digits.map((digit) => String(Math.min(Number(digit), 65535))).join('.')
}
