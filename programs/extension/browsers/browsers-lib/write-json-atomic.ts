// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'

// Automation polls ready.json while the CLI stamps it, so an in-place write
// can be read half-written. A rename swaps the whole file in one step.
export function writeJsonAtomic(filePath: string, value: unknown): boolean {
  const tmpPath = `${filePath}.tmp-${process.pid}`

  try {
    fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2), 'utf-8')
    fs.renameSync(tmpPath, filePath)

    return true
  } catch {
    try {
      fs.rmSync(tmpPath, {force: true})
    } catch {
      // best-effort; the stamp itself already failed
    }

    return false
  }
}
