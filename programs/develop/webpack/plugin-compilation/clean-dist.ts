//  ██████╗ ██████╗ ███╗   ███╗██████╗ ██╗██╗      █████╗ ████████╗██╗ ██████╗ ███╗   ██╗
// ██╔════╝██╔═══██╗████╗ ████║██╔══██╗██║██║     ██╔══██╗╚══██╔══╝██║██╔═══██╗████╗  ██║
// ██║     ██║   ██║██╔████╔██║██████╔╝██║██║     ███████║   ██║   ██║██║   ██║██╔██╗ ██║
// ██║     ██║   ██║██║╚██╔╝██║██╔═══╝ ██║██║     ██╔══██║   ██║   ██║██║   ██║██║╚██╗██║
// ╚██████╗╚██████╔╝██║ ╚═╝ ██║██║     ██║███████╗██║  ██║   ██║   ██║╚██████╔╝██║ ╚████║
//  ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝     ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚═╝ ╚═════╝ ╚═╝  ╚═══╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as fs from 'fs'
import * as path from 'path'
import {type Compiler} from '@rspack/core'
import * as messages from './compilation-lib/messages'

const rmdirSync = fs.rmdirSync as unknown as (
  path: fs.PathLike,
  options?: {recursive?: boolean}
) => void

export class CleanDistFolderPlugin {
  constructor(private options: {browser: string}) {}
  apply(compiler: Compiler): void {
    const logger = compiler.getInfrastructureLogger('plugin-compilation:clean')
    const distPath = path.join(
      compiler.options.context!,
      'dist',
      this.options.browser
    )

    if (fs.existsSync(distPath)) {
      const removedCount = countFilesRecursively(distPath)

      if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
        console.log(messages.cleanDistStarting(distPath))
      }

      try {
        if (fs.rmSync) {
          fs.rmSync(distPath, {recursive: true, force: true})
        } else {
          // Node <14 fallback
          rmdirSync(distPath, {recursive: true})
        }
        if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
          console.log(messages.cleanDistRemovedSummary(removedCount, distPath))
        }

        if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
          logger.info(
            '[CleanDistFolderPlugin] Removed old hot-update files before compilation.'
          )
        }
      } catch (error: any) {
        // Retry once on Windows when files are temporarily locked
        if (
          process.platform === 'win32' &&
          /EBUSY|EPERM/i.test(String(error?.code || error?.message))
        ) {
          setTimeout(() => {
            try {
              if (fs.rmSync) {
                fs.rmSync(distPath, {recursive: true, force: true})
              } else {
                rmdirSync(distPath, {recursive: true})
              }
            } catch {
              // Ignore
            }
          }, 100)
        }

        logger.error(
          `[CleanDistFolderPlugin] Failed to remove hot-update files: ${error.message}`
        )
      }
    } else {
      if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
        console.log(messages.cleanDistSkippedNotFound(distPath))
      }
    }
  }
}

function countFilesRecursively(dir: string): number {
  try {
    const entries = fs.readdirSync(dir, {withFileTypes: true})
    let total = 0

    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) total += countFilesRecursively(full)
      else total += 1
    }

    return total
  } catch {
    return 0
  }
}
