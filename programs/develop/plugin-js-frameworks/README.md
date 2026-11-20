[powered-image]: https://img.shields.io/badge/Empowering-Extension.js-0065e6
[powered-url]: https://extension.js.org
[pr-welcome-image]: https://img.shields.io/badge/pull--requests-welcome-2ecc40
[pr-welcome-url]: https://github.com/extension-js/extension.js/pulls

[![Empowering Extension.js][powered-image]][powered-url] [![Pull requests welcome][pr-welcome-image]][pr-welcome-url]

# plugin-js-frameworks

Wires JavaScript frameworks and TypeScript into the Rspack build Extension.js runs. It:

- Detects React, Preact, Vue, Svelte and Solid from the project's `package.json`, and TypeScript from a `tsconfig.json` next to TypeScript sources or a `typescript` dependency
- Compiles scripts with SWC. The file extension picks the parser (`.ts`, `.tsx`, `.jsx`, `.js` and their `m`/`c` forms), the installed framework picks the automatic JSX runtime (`solid-js`, then `preact` when React is absent, then `vue` when React and Preact are absent, else `react`)
- Parses decorators in every script. `experimentalDecorators` in the `tsconfig.json` or `jsconfig.json` (read through `extends`) compiles them as TypeScript's legacy decorators, with `emitDecoratorMetadata` honored, otherwise they compile as standard decorators (the 2022-03 proposal)
- Follows the other transform flags SWC supports from the same config: `jsxImportSource` replaces the detected JSX runtime, and `useDefineForClassFields`, when set, chooses how class fields compile. A config without the key builds as before
- Runs the project's own Babel config when it has one: `babel.config.(js|cjs|mjs|json|cts|mts|ts)`, `.babelrc`, `.babelrc.*` or a `babel` key in `package.json`, in the project folder. Babel runs first, on project scripts only (not `node_modules`), with only the syntax plugins it needs to read TypeScript, JSX and decorators, and SWC compiles its output as for any other project. A project without a Babel config never loads Babel for plain scripts
- Takes the SWC targets from the manifest: `minimum_chrome_version` for a Chromium build, the Gecko `strict_min_version` for a Firefox build, `chrome >= 100` otherwise
- Compiles content scripts in their own layer as classic scripts, each file once, and compiles a `"type": "module"` service worker or a `<script type="module">` page script as an ES module
- Points `resolve.tsConfig` at the project's `tsconfig.json`, or its `jsconfig.json` in a JavaScript project, so path aliases resolve
- Writes a default `tsconfig.json` when the build reaches TypeScript sources and the project has none
- Configures everything before the first compilation: on `beforeRun` in production, eagerly in development

Optional tooling (the React refresh plugin, `vue-loader`, `svelte-loader`, Solid's Babel stack, `babel-loader` for a project Babel config) is resolved from the project first, then from Extension.js. Nothing is installed: a missing package fails the build with the install command for the project's package manager.

### Frameworks

| Framework | What the plugin adds |
| --------- | -------------------- |
| **React** | Aliases `react`, `react-dom`, `react-dom/client` and both JSX runtimes to one copy. In development it adds `@rspack/plugin-react-refresh` and puts the refresh runtime in front of page entries only, never content scripts or the background. |
| **Preact** | Aliases `preact` and its JSX runtimes, and aliases `react` and `react-dom` to `preact/compat` when React is not a dependency. Fast refresh is off: Preact pages reload. |
| **Vue** | Vue 3: `vue-loader` with `VueLoaderPlugin`, the Vue feature flags, and the runtime-only ES module build. A `.vue` file inside `node_modules` compiles like a project one. The feature flags (`__VUE_OPTIONS_API__` on, the two `__VUE_PROD_*` flags on in development only) are defaults: a flag the project defines, through the `define` key or a `DefinePlugin` from the `config` hook of `extension.config.js`, keeps the project's value. Options from `vue.loader.(ts\|mts\|js\|mjs)` merge over the defaults. Vue 2: plain scripts build, and a `.vue` file fails the build with one error naming it. |
| **Svelte** | `svelte-loader` for `.svelte`, `.svelte.js` and `.svelte.ts` (SWC strips the types first), with `dev` and `hotReload` on in development. The `svelte` export condition comes first in script resolution, so a component library that publishes only under it resolves. Options from `svelte.loader.(ts\|mts\|js\|mjs)` merge over the defaults. When the compiler is newer than the project's `svelte`, the runtime follows the compiler and a warning says so. |
| **Solid** | Solid's own compiler through Babel (`babel-preset-solid`, plus `@babel/preset-typescript` for `.tsx`), the way `vite-plugin-solid` runs it. A plain `.js` file goes to Babel only when it holds JSX. `.ts` files stay on SWC. With a project Babel config, that config joins Solid's presets and every plain `.js` file goes to Babel. |
| **TypeScript** | The SWC TypeScript parser by extension, the scaffolded `tsconfig.json`, and `resolve.tsConfig`. No `typescript` package is needed to build. |

### Usage

```ts
import {JsFrameworksPlugin} from './plugin-js-frameworks'

export default {
  plugins: [
    new JsFrameworksPlugin({
      manifestPath: '/abs/path/to/manifest.json',
      browser: 'chrome',
      mode: 'development',
      transpilePackages: ['@acme/ui'],
      define: {__VUE_OPTIONS_API__: false}
    })
  ]
}
```

### API

```ts
export class JsFrameworksPlugin {
  static readonly name: 'plugin-js-frameworks'
  constructor(options: {
    manifestPath: string
    // The build target. Picks the manifest keys and the SWC targets. Defaults to 'chrome'.
    browser?: DevOptions['browser']
    mode: 'development' | 'production'
    // Packages under node_modules that compile like project sources.
    transpilePackages?: string[]
    // The project's `define` constants. A framework default they name steps aside.
    define?: Record<string, unknown>
  })
  apply(compiler: import('@rspack/core').Compiler): Promise<void>
}
```
