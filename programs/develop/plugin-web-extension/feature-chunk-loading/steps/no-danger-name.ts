// ██╗      ██████╗  █████╗ ██████╗ ███████╗██████╗
// ██║     ██╔═══██╗██╔══██╗██╔══██╗██╔════╝██╔══██╗
// ██║     ██║   ██║███████║██║  ██║█████╗  ██████╔╝
// ██║     ██║   ██║██╔══██║██║  ██║██╔══╝  ██╔══██╗
// ███████╗╚██████╔╝██║  ██║██████╔╝███████╗██║  ██║
// ╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝ ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {Compiler} from '@rspack/core'

// Derived from webpack-target-webextension (MIT, Copyright 2020 CRIMX).
// The license notice is in the README of this folder.

export class NoDangerNamePlugin {
  apply(compiler: Compiler) {
    const {Compilation, WebpackError} = compiler.webpack

    compiler.hooks.thisCompilation.tap(
      NoDangerNamePlugin.name,
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: NoDangerNamePlugin.name,
            stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONS
          },
          (assets) => {
            for (const name of Object.keys(assets || {})) {
              if (!name.startsWith('_')) continue

              // The platform itself reserves _locales/ for translations and
              // _metadata/ for store contents, so both are real outputs.
              if (
                name.startsWith('_locales/') ||
                name.startsWith('_metadata/')
              ) {
                continue
              }

              // A browser refuses to load an extension that ships any other
              // file or folder whose name starts with an underscore.
              const e = new WebpackError(
                `[webpack-extension-target] Output file name ${JSON.stringify(
                  name
                )} starts with "_" which is prohibited.`
              )
              e.stack = ''
              compilation.errors.push(e)
            }
          }
        )
      }
    )
  }
}
