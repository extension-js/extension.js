// webpack uses JavaScript entries to enable HMR
// but sometimes the user content_scripts might have only .css-like
// files without scripts declared. So we ensure CSS entries have at
// least one script, and that script is HMR enabled.
// @ts-ignore
if (import.meta.webpackHot) {
  // @ts-ignore
  import.meta.webpackHot.accept()
}
