// ███████╗██████╗ ███████╗ ██████╗██╗ █████╗ ██╗      ███████╗ ██████╗ ██╗     ██████╗ ███████╗██████╗ ███████╗
// ██╔════╝██╔══██╗██╔════╝██╔════╝██║██╔══██╗██║      ██╔════╝██╔═══██╗██║     ██╔══██╗██╔════╝██╔══██╗██╔════╝
// ███████╗██████╔╝█████╗  ██║     ██║███████║██║█████╗█████╗  ██║   ██║██║     ██║  ██║█████╗  ██████╔╝███████╗
// ╚════██║██╔═══╝ ██╔══╝  ██║     ██║██╔══██║██║╚════╝██╔══╝  ██║   ██║██║     ██║  ██║██╔══╝  ██╔══██╗╚════██║
// ███████║██║     ███████╗╚██████╗██║██║  ██║███████╗ ██║     ╚██████╔╝███████╗██████╔╝███████╗██║  ██║███████║
// ╚══════╝╚═╝     ╚══════╝ ╚═════╝╚═╝╚═╝  ╚═╝╚══════╝ ╚═╝      ╚═════╝ ╚══════╝╚═════╝ ╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {type Compilation, WebpackError} from '@rspack/core'
import * as messages from './messages'
import {hasPrivateFileName} from './public-private-files'

// The bundler names the output path it could not write twice, never the input
// that collided with a generated entry. The guard reads the raised error
// rather than predicting the clash, because by the time this runs the real
// conflicting filename is known and cannot be guessed wrong.
const CONFLICT = /same filename\s+(\S+?)\.?(?:\s|$)/

export function explainPublicOutputCollision(
  compilation: Compilation,
  publicDir: string
): void {
  try {
    if (!publicDir || !fs.existsSync(publicDir)) return

    for (const error of compilation.errors) {
      // The diagnostic arrives styled, so the needle is matched on plain text.
      const message = String((error as Error)?.message || '').replace(
        /\u001b\[[0-9;]*m/g,
        ''
      )
      if (!/Multiple assets emit different content/.test(message)) continue

      const match = CONFLICT.exec(message)
      if (!match) continue

      const emitted = match[1]
      const source = path.join(publicDir, emitted)
      if (!fs.existsSync(source)) continue

      const relative = path.join(path.basename(publicDir), emitted)
      const explained = new WebpackError(
        messages.publicFileCollidesWithEntry(relative, emitted)
      ) as Error & {file?: string}
      explained.name = 'PublicOutputCollision'
      explained.file = relative
      compilation.errors.push(explained)
    }
  } catch {
    // Ignore
  }
}

// The public/ files, by their path inside the folder, whose output path an
// entry wrote first. The copier keeps the entry's file and copies nothing.
export function publicFilesShadowedByEntries(
  compilation: Compilation,
  publicDir: string,
  excluded: ReadonlySet<string>
): string[] {
  const explained = new Set(
    compilation.errors
      .filter((error) => (error as Error)?.name === 'PublicOutputCollision')
      .map((error) => String((error as {file?: string}).file || ''))
  )
  const shadowed: string[] = []

  for (const asset of compilation.getAssets()) {
    const name = asset.name.split(path.sep).join('/')

    // The generated manifest has its own error, and these names never copy.
    if (name === 'manifest.json' || hasPrivateFileName(name)) continue

    const source = path.join(publicDir, ...name.split('/'))

    if (excluded.has(source)) continue
    if (explained.has(path.join(path.basename(publicDir), name))) continue

    // A copier wrote it, this folder's or the include one: no entry's file.
    if (asset.info.copied) continue

    try {
      if (!fs.statSync(source).isFile()) continue
    } catch {
      continue
    }

    shadowed.push(name)
  }

  return shadowed.sort()
}
