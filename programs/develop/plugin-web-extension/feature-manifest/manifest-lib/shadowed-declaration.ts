// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {winningPrefixedKey} from '../../../lib/manifest-utils'
import type {DevOptions, Manifest} from '../../../types'

export interface ShadowedDeclaration {
  // replaced: the plain list holds the value and a prefixed key for this
  // build took the list's place. elsewhere: a key this build skips holds it.
  kind: 'replaced' | 'elsewhere'
  listedUnder: string
  // The key as written that this build reads the list from
  readKey: string
  browser: string
}

const PERMISSION_KEYS = ['permissions', 'optional_permissions'] as const

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

// A prefixed key replaces the plain one for its browser, so a value the
// author wrote can be absent from the build while present in the file.
export function findShadowedPermission(
  authored: Manifest | undefined,
  browser: DevOptions['browser'],
  permission: string
): ShadowedDeclaration | undefined {
  if (!authored || typeof authored !== 'object') return undefined

  const source = authored as Record<string, unknown>
  const winners = PERMISSION_KEYS.map(
    (plain) => [plain, winningPrefixedKey(authored, plain, browser)] as const
  )

  for (const [plain, winner] of winners) {
    if (
      winner &&
      stringList(source[plain]).includes(permission) &&
      !stringList(source[winner]).includes(permission)
    ) {
      return {
        kind: 'replaced',
        listedUnder: plain,
        readKey: winner,
        browser: String(browser)
      }
    }
  }

  for (const [plain, winner] of winners) {
    for (const key of Object.keys(source)) {
      const indexOfColon = key.indexOf(':')

      if (
        indexOfColon !== -1 &&
        key !== winner &&
        key.substring(indexOfColon + 1) === plain &&
        stringList(source[key]).includes(permission)
      ) {
        return {
          kind: 'elsewhere',
          listedUnder: key,
          readKey: winner ?? plain,
          browser: String(browser)
        }
      }
    }
  }

  return undefined
}

// The same replacement on a host list: the plain key names hosts and the
// prefixed key this build reads names none.
export function findReplacedHostList(
  authored: Manifest | undefined,
  browser: DevOptions['browser']
): ShadowedDeclaration | undefined {
  if (!authored || typeof authored !== 'object') return undefined

  const source = authored as Record<string, unknown>
  const winner = winningPrefixedKey(authored, 'host_permissions', browser)

  if (!winner || !stringList(source.host_permissions).length) return undefined
  if (stringList(source[winner]).length) return undefined

  return {
    kind: 'replaced',
    listedUnder: 'host_permissions',
    readKey: winner,
    browser: String(browser)
  }
}
