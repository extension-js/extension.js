//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

// Missing-preprocessor passthrough (bug 26).
//
// When a project ships .scss/.sass/.less sources without declaring the
// matching compiler (`sass` / `less`) as a dependency, the rule set routes
// those files as plain CSS for Chrome parity, the browser loads a
// manifest-declared preprocessor stylesheet as raw text and drops the rules
// it can't parse. That parity must not be silent: raw preprocessor source is
// knowingly-invalid CSS, so every file that ships uncompiled gets a loud
// compilation warning telling the author to install the compiler.

import * as path from 'path'
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
    new Error(messages.preprocessorShippedUncompiled(this.resourcePath, tool))
  )
  return source
}
