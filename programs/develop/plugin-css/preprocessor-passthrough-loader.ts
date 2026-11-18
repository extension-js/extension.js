//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as path from 'node:path'
import {toProjectRelativePath} from '../lib/resource-path'
import * as messages from './css-lib/messages'

export interface PreprocessorPassthroughLoaderOptions {
  // The install command for each tool, in the project's package manager.
  install: Record<'sass' | 'less', string>
}

interface PreprocessorPassthroughLoaderContext {
  resourcePath: string
  rootContext?: string
  getOptions(): PreprocessorPassthroughLoaderOptions
  emitWarning(warning: Error): void
}

export default function preprocessorPassthroughLoader(
  this: PreprocessorPassthroughLoaderContext,
  source: string
): string {
  const ext = path.extname(this.resourcePath || '').toLowerCase()
  const tool = ext === '.less' ? 'less' : 'sass'
  this.emitWarning(
    Object.assign(
      new Error(
        messages.preprocessorShippedUncompiled(
          toProjectRelativePath(this.rootContext, this.resourcePath),
          tool,
          this.getOptions().install[tool]
        )
      ),
      {name: 'CssPreprocessorMissing'}
    )
  )

  return source
}
