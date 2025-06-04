// This is an optional file for Svelte projects by Extension.js.
// It allows you to adapt svelte-loader's behavior to your project needs.
// If you don't need it, you can remove it.
// Original implementation: programs/develop/webpack/plugin-js-frameworks/js-tools/svelte.ts

export default (options) => {
  return {
    // See Svelte Compiler options section
    // https://www.npmjs.com/package/svelte-loader
    ...options
  }
}
