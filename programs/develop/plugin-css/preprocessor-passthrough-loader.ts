//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as path from 'node:path'
import * as messages from './css-lib/messages'

interface PreprocessorPassthroughLoaderContext {
  resourcePath: string
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
        messages.preprocessorShippedUncompiled(this.resourcePath, tool)
      ),
      {name: 'CssPreprocessorMissing'}
    )
  )

  return source
}
