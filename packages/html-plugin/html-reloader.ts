// Sometimes, the user HTML file might not have a script tag
// but webpack uses JavaScript entries to enable HMR.
// So we ensure HTML entries have at least one script,
// and that script is HMR enabled.
// @ts-ignore
if (import.meta.webpackHot) {
  // @ts-ignore
  import.meta.webpackHot.accept()
}
