//  ██████╗ ██████╗ ███╗   ███╗██████╗ ██╗██╗      █████╗ ████████╗██╗ ██████╗ ███╗   ██╗
// ██╔════╝██╔═══██╗████╗ ████║██╔══██╗██║██║     ██╔══██╗╚══██╔══╝██║██╔═══██╗████╗  ██║
// ██║     ██║   ██║██╔████╔██║██████╔╝██║██║     ███████║   ██║   ██║██║   ██║██╔██╗ ██║
// ██║     ██║   ██║██║╚██╔╝██║██╔═══╝ ██║██║     ██╔══██║   ██║   ██║██║   ██║██║╚██╗██║
// ╚██████╗╚██████╔╝██║ ╚═╝ ██║██║     ██║███████╗██║  ██║   ██║   ██║╚██████╔╝██║ ╚████║
//  ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝     ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚═╝ ╚═════╝ ╚═╝  ╚═══╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Compiler} from '@rspack/core'
import {isDebug} from '../lib/messaging'
import * as messages from './compilation-lib/messages'

export class CleanDistFolderPlugin {
  constructor(private options: {browser: string}) {}
  apply(compiler: Compiler): void {
    const logger = compiler.getInfrastructureLogger('plugin-compilation:clean')
    // Clean exactly where this compiler emits. Deriving the target from the
    // context would delete an unrelated dir under a custom output.path, and
    // in the staged one-shot flow it would destroy the live last-good dist
    // while the compiler only ever writes into the staging sibling.
    const configuredOutputPath = compiler.options.output?.path
    const distPath =
      typeof configuredOutputPath === 'string' && configuredOutputPath
        ? configuredOutputPath
        : path.join(compiler.options.context!, 'dist', this.options.browser)

    if (fs.existsSync(distPath)) {
      const removedCount = countFilesRecursively(distPath)

      if (isDebug()) {
        console.log(messages.cleanDistStarting(distPath))
      }

      try {
        fs.rmSync(distPath, {recursive: true, force: true})

        if (isDebug()) {
          console.log(messages.cleanDistRemovedSummary(removedCount, distPath))
          logger.info(
            '[CleanDistFolderPlugin] Removed old hot-update files before compilation.'
          )
        }
      } catch (caught) {
        const error = caught as NodeJS.ErrnoException
        // Windows can transiently lock files (EBUSY/EPERM); retry shortly and
        // don't surface an error for the recoverable case
        if (
          process.platform === 'win32' &&
          /EBUSY|EPERM/i.test(String(error?.code || error?.message))
        ) {
          setTimeout(() => {
            try {
              fs.rmSync(distPath, {recursive: true, force: true})
            } catch {
              // Ignore
            }
          }, 100)
          return
        }

        logger.error(
          `[CleanDistFolderPlugin] Failed to remove hot-update files: ${error.message}`
        )
      }
    } else {
      if (isDebug()) {
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
