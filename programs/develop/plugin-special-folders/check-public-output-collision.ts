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
