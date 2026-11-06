// ███╗   ███╗███████╗███████╗███████╗ █████╗  ██████╗ ██╗███╗   ██╗ ██████╗
// ████╗ ████║██╔════╝██╔════╝██╔════╝██╔══██╗██╔════╝ ██║████╗  ██║██╔════╝
// ██╔████╔██║█████╗  ███████╗███████╗███████║██║  ███╗██║██╔██╗ ██║██║  ███╗
// ██║╚██╔╝██║██╔══╝  ╚════██║╚════██║██╔══██║██║   ██║██║██║╚██╗██║██║   ██║
// ██║ ╚═╝ ██║███████╗███████║███████║██║  ██║╚██████╔╝██║██║ ╚████║╚██████╔╝
// ╚═╝     ╚═╝╚══════╝╚══════╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═╝╚═╝  ╚═══╝ ╚═════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'

// Mirror of programs/develop/lib/localized-manifest-name.ts for the browser
// runner bundle, which loads the develop program only at runtime.
const MSG_NAME = /^__MSG_([A-Za-z0-9_@]+)__$/

export interface LocalizedNameOptions {
  // Printed in place of the raw key when no messages file resolves it.
  whenUnresolved?: string
  // The reader's language, BCP 47 or Chrome folder spelling; the machine's by default.
  systemLocale?: string
}

export interface LocalizableManifest {
  name?: unknown
  default_locale?: unknown
}

// Chrome spells locale folders pt_BR and en, so a BCP 47 tag from the OS is
// rewritten to that shape before it names a folder.
function toLocaleFolder(locale: unknown): string {
  const [language = '', ...rest] = String(locale ?? '')
    .trim()
    .split(/[-_]/)

  return [language.toLowerCase(), ...rest.map((part) => part.toUpperCase())]
    .filter(Boolean)
    .join('_')
}

// The manifest's default_locale first, then the machine's language, then its
// bare language code, each folder name only once.
function localeCandidates(defaultLocale: unknown, systemLocale?: string) {
  const system =
    systemLocale ?? Intl.DateTimeFormat().resolvedOptions().locale ?? ''
  const folders = [
    toLocaleFolder(defaultLocale),
    toLocaleFolder(system),
    toLocaleFolder(String(system).split(/[-_]/)[0])
  ]

  return folders.filter(
    (folder, index) => folder && folders.indexOf(folder) === index
  )
}

export function resolveLocalizedManifestName(
  manifest: LocalizableManifest | null | undefined,
  searchRoots: string[],
  options: LocalizedNameOptions = {}
): string {
  const raw = typeof manifest?.name === 'string' ? manifest.name.trim() : ''
  const match = raw.match(MSG_NAME)
  if (!match) return raw

  for (const locale of localeCandidates(
    manifest?.default_locale,
    options.systemLocale
  )) {
    for (const root of searchRoots) {
      if (!root) continue

      try {
        const file = path.join(root, '_locales', locale, 'messages.json')
        const message = JSON.parse(
          fs.readFileSync(file, 'utf-8').replace(/^﻿/, '')
        )?.[match[1]]?.message

        if (typeof message === 'string' && message.trim()) return message.trim()
      } catch {
        // No messages file at this root, the next root or locale may have it.
      }
    }
  }

  return options.whenUnresolved ?? raw
}
