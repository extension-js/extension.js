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
              // `_locales/` and `_metadata/` are the two underscore-prefixed
              // paths the WebExtensions platform itself reserves and permits:
              // `_locales/<lang>/messages.json` is the i18n directory every
              // localized extension ships (required when `default_locale` is
              // set), and `_metadata/` holds store-generated verified contents.
              // They are legitimate outputs, not the accidental webpack-runtime
              // chunks this guard exists to catch, so they must pass. `build`
              // already emits them fine; without this, `dev` fails to compile
              // any internationalized extension.
              if (
                name.startsWith('_locales/') ||
                name.startsWith('_metadata/')
              ) {
                continue
              }
              // Any OTHER "_"-prefixed name is preserved by the browser and
              // bypasses special handling — that's the dangerous case.
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
