// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Manifest} from '../../../types'

export interface FatalShapeFix {
  field: string
  detail: string
}

export function sanitizeFatalManifestShapes(
  manifest: Manifest,
  manifestDir?: string
): {
  manifest: Manifest
  fixes: FatalShapeFix[]
} {
  const out = manifest as Record<string, unknown>
  const fixes: FatalShapeFix[] = []

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
