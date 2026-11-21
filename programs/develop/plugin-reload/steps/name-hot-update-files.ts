// ██████╗ ███████╗██╗      ██████╗  █████╗ ██████╗
// ██╔══██╗██╔════╝██║     ██╔═══██╗██╔══██╗██╔══██╗
// ██████╔╝█████╗  ██║     ██║   ██║███████║██║  ██║
// ██╔══██╗██╔══╝  ██║     ██║   ██║██╔══██║██║  ██║
// ██║  ██║███████╗███████╗╚██████╔╝██║  ██║██████╔╝
// ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {Compiler} from '@rspack/core'

// A reload session fetches and prunes hot update files by chunk and build
// hash alone. A dev server with reload off keeps the suffix it writes.
function hotUpdateFileNames(reloads: boolean): {
  chunk: string
  main: string
} {
  const suffix = reloads ? '' : '.hot-update'

  return {
    chunk: `hot/[id].[fullhash]${suffix}.js`,
    main: `hot/[runtime].[fullhash]${suffix}.json`
  }
}

// The one place the hot update files of a dev server compile are named.
export class NameHotUpdateFiles {
  public static readonly name = 'plugin-reload:hot-update-names'

  constructor(private readonly reloads: boolean) {}

  public apply(compiler: Compiler): void {
    compiler.hooks.environment.tap(NameHotUpdateFiles.name, () => {
      const names = hotUpdateFileNames(this.reloads)

      compiler.options.output.hotUpdateChunkFilename = names.chunk
      compiler.options.output.hotUpdateMainFilename = names.main
    })
  }
}
