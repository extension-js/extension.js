export default class NoDangerNamePlugin {
  apply(compiler: any) {
    const {Compilation, WebpackError} = compiler.webpack
    compiler.hooks.thisCompilation.tap(
      NoDangerNamePlugin.name,
      (compilation: any) => {
        compilation.hooks.processAssets.tap(
          {
            name: NoDangerNamePlugin.name,
            stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONS
          },
          (assets: any) => {
            for (const name of Object.keys(assets || {})) {
              if (!name.startsWith('_')) continue
              // Path starts with "_" is preserved by the browser.
              // This can be dangerous because it bypasses special handling.
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
