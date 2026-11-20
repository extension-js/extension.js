// ██████╗ ███████╗██╗      ██████╗  █████╗ ██████╗
// ██╔══██╗██╔════╝██║     ██╔═══██╗██╔══██╗██╔══██╗
// ██████╔╝█████╗  ██║     ██║   ██║███████║██║  ██║
// ██╔══██╗██╔══╝  ██║     ██║   ██║██╔══██║██║  ██║
// ██║  ██║███████╗███████╗╚██████╔╝██║  ██║██████╔╝
// ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Compilation, Compiler} from '@rspack/core'
import {keepResourcesReachable} from '../../plugin-web-extension/shared/kept-resource-extensions'

const CONTENT_SCRIPTS_FOLDER = 'content_scripts'

// A tab opened before a rebuild still names the sheet of the build it
// loaded. A dev output is never cleaned, so that sheet is read from disk.
export function stylesheetsOpenTabsMayStillRead(
  outputPath: string | undefined
): string[] {
  if (!outputPath) return []

  try {
    return fs
      .readdirSync(path.join(outputPath, CONTENT_SCRIPTS_FOLDER))
      .filter((name) => name.endsWith('.css'))
      .map((name) => `${CONTENT_SCRIPTS_FOLDER}/${name}`)
  } catch {
    // No folder yet means no earlier compile left a sheet behind
    return []
  }
}

function leftoverStylesheets(compilation: Compilation): string[] {
  // A production build cleans its output first, so nothing is left to read.
  if ((compilation.options?.mode || 'development') === 'production') return []

  return stylesheetsOpenTabsMayStillRead(compilation.options?.output?.path)
}

export class KeepOpenTabStylesheets {
  apply(compiler: Compiler): void {
    keepResourcesReachable(compiler, leftoverStylesheets)
  }
}
