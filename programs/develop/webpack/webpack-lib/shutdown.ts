// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import {type Compiler} from '@rspack/core'

export function createShutdownHandler(compiler: Compiler) {
  let isShuttingDown = false

  const shutdown = (code = 0) => {
    if (isShuttingDown) return
    isShuttingDown = true

    try {
      compiler.close(() => {
        process.exit(code)
      })

      // Safety net in case close callback never fires
      setTimeout(() => process.exit(code), 2000)
    } catch {
      process.exit(code)
    }
  }

  process.on('SIGINT', () => shutdown(0))
  process.on('SIGTERM', () => shutdown(0))
  process.on('SIGHUP', () => shutdown(0))

  return shutdown
}
