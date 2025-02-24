// @ts-check
module.exports = class WebExtensionNoDangerNamePlugin {
  /**
   * @param {import("webpack").Compiler} compiler
   */
  apply(compiler) {
    const { WebpackError } = compiler.webpack

    // Chrome bug https://bugs.chromium.org/p/chromium/issues/detail?id=1108199
    {
      const optimization = compiler.options.optimization

      if (optimization.splitChunks === undefined) optimization.splitChunks = { automaticNameDelimiter: '-' }
      else if (optimization.splitChunks && optimization.splitChunks.automaticNameDelimiter === undefined) {
        optimization.splitChunks.automaticNameDelimiter = '-'
      }
    }

    compiler.hooks.emit.tap(WebExtensionNoDangerNamePlugin.name, (compilation) => {
      const with_ = []
      const withTilde = []
      for (const file in compilation.assets) {
        if (file.startsWith('_')) {
          if (file.startsWith('_locales/') || file === '_locales') {
          } else with_.push(String(file))
        }
        if (file.includes('~')) withTilde.push(String(file))
      }
      if (with_.length) {
        const e = new WebpackError(
          `[webpack-extension-target]
Path starts with "_" is preserved by the browser.
The browser will refuse to load this extension.
Please adjust your webpack configuration to remove that.
File(s) starts with "_":
` + with_.map((x) => '    ' + x).join('\n'),
        )
        e.stack = ''
        compilation.errors.push(e)
      }
      if (withTilde.length) {
        const e = new WebpackError(
          `[webpack-extension-target]
File includes "~" is not be able to loaded by Chrome due to a bug https://bugs.chromium.org/p/chromium/issues/detail?id=1108199.
Please adjust your webpack configuration to remove that.
If you're using splitChunks, please set config.optimization.splitChunks.automaticNameDelimiter to other char like "-".
If you're using runtimeChunks, please set config.optimization.runtimeChunk.name to a function like
    entrypoint => \`runtime-\${entrypoint.name}\`
File(s) includes "~":
` + withTilde.map((x) => '    ' + x).join('\n'),
        )
        e.stack = ''
        compilation.errors.push(e)
      }
    })
  }
}
