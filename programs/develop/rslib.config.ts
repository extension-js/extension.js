// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import {createRequire} from 'node:module'
import * as path from 'node:path'
import type {RslibConfig} from '@rslib/core'
import {defineConfig} from '@rslib/core'

const require = createRequire(import.meta.url)

// The parsers the declaration plugin has shipped with, oldest first.
export const DTS_PARSERS = ['@ast-grep/napi', '@swc-next/parser']

function findPackageDir(name: string, from: string): string | undefined {
  for (let dir = from; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', name)

    if (fs.existsSync(path.join(candidate, 'package.json'))) {
      return fs.realpathSync(candidate)
    }

    if (path.dirname(dir) === dir) return undefined
  }
}

function readEntryFile(packageDir: string): string {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8')
  )
  const root = manifest.exports?.['.'] ?? manifest.exports
  const entry =
    typeof root === 'string'
      ? root
      : root?.require || root?.import || root?.default || manifest.main

  return path.join(packageDir, typeof entry === 'string' ? entry : 'index.js')
}

// The declaration plugin owns its native parser and swapped it between
// releases, so the probe reads the name from the plugin's own dependencies.
export function findDtsParser(
  from: string = __dirname
): {name: string; entry: string} | undefined {
  const rslibDir = findPackageDir('@rslib/core', from)
  const pluginDir = rslibDir && findPackageDir('rsbuild-plugin-dts', rslibDir)
  if (!pluginDir) return undefined

  const {dependencies = {}} = JSON.parse(
    fs.readFileSync(path.join(pluginDir, 'package.json'), 'utf8')
  )
  const name = DTS_PARSERS.find((parser) => parser in dependencies)
  if (!name) return undefined

  // A declared parser that is not installed keeps the path it was expected
  // at, so the probe fails on it and never loads a copy from somewhere else.
  const parserDir = findPackageDir(name, pluginDir)
  const entry = parserDir
    ? readEntryFile(parserDir)
    : path.join(pluginDir, 'node_modules', name)

  return {name, entry}
}

// Declarations are part of what ships, so a build that cannot write them
// stops. EXTENSION_SKIP_DTS=1 is the stated way to build without them.
export function resolveDtsGeneration(
  load: () => unknown,
  env: Record<string, string | undefined> = process.env,
  parser = '@ast-grep/napi'
): boolean {
  if (env.EXTENSION_SKIP_DTS === '1') return false

  try {
    load()

    return true
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)

    throw new Error(
      [
        `[Extension.js] Type declarations cannot be generated: ${parser} failed to load.`,
        reason.split('\n')[0],
        'Reinstall the dependencies, or set EXTENSION_SKIP_DTS=1 to build without declarations.'
      ].join('\n')
    )
  }
}

// A plugin that names none of the known parsers has nothing here to probe.
const dtsParser = findDtsParser()
const shouldGenerateDts = resolveDtsGeneration(
  () => dtsParser && require(dtsParser.entry),
  process.env,
  dtsParser?.name
)

// autoExternal already keeps every package.json dependency out of the bundle.
// solid-js is the user's own package, so it is named here.
const externals = ['solid-js/h']

// Browser-side runtime files run INSIDE the user's extension; they must not
// receive the Node-only require shim (node:module is unresolvable there).
export const browserEntries = {
  'minimum-script-file': path.resolve(
    __dirname,
    './plugin-reload/reload-lib/minimum-files/minimum-script-file.ts'
  ),
  'page-socket-client': path.resolve(
    __dirname,
    './plugin-reload/reload-lib/page-socket-client.ts'
  ),
  'solid-jsx-runtime': path.resolve(
    __dirname,
    './plugin-js-frameworks/js-tools/solid-jsx-runtime.ts'
  ),
  // MAIN world bridge helper (must exist on disk for manifest/script validation during builds)
  'main-world-bridge': path.resolve(
    __dirname,
    './plugin-web-extension/feature-scripts/steps/add-content-script-wrapper/main-world-bridge.js'
  ),
  'minimum-chromium-file': path.resolve(
    __dirname,
    './plugin-reload/reload-lib/minimum-files/minimum-background-file-chromium.ts'
  ),
  'minimum-firefox-file': path.resolve(
    __dirname,
    './plugin-reload/reload-lib/minimum-files/minimum-background-file-firefox.ts'
  )
}

// Wire constants and frame types only, web target and no shim, so the
// emitted chunk imports nothing and browser bundles can consume it.
export const contractsEntries = {
  contracts: path.resolve(__dirname, './contracts-entry.ts')
}

// The canonical machine contract lives in the extension program's spec tree;
// the published package ships a byte-for-byte copy under dist/contract.
const contractDir = path.resolve(__dirname, '../extension/__spec__/contract')

// Node-side entries and rspack loaders run at build time on Node, so they need
// the require shim for bundled bare require()/require.resolve() sites.
export const nodeEntries = {
  module: path.resolve(__dirname, './module.ts'),
  preview: path.resolve(__dirname, './preview-entry.ts'),
  bridge: path.resolve(__dirname, './bridge-entry.ts'),
  'ensure-hmr-for-scripts': path.resolve(
    __dirname,
    './plugin-reload/steps/ensure-hmr-for-scripts.ts'
  ),
  'feature-scripts-content-script-wrapper': path.resolve(
    __dirname,
    './plugin-web-extension/feature-scripts/steps/add-content-script-wrapper/content-script-wrapper.ts'
  ),
  'feature-scripts-classic-concat-loader': path.resolve(
    __dirname,
    './plugin-web-extension/feature-scripts/steps/add-content-script-wrapper/classic-concat-loader.ts'
  ),
  'feature-scripts-native-geturl-import-loader': path.resolve(
    __dirname,
    './plugin-web-extension/feature-scripts/steps/native-geturl-import-loader.ts'
  ),
  'feature-scripts-classic-traced-globals-loader': path.resolve(
    __dirname,
    './plugin-web-extension/feature-scripts/steps/classic-traced-globals-loader.ts'
  ),
  'css-parse-guard-loader': path.resolve(
    __dirname,
    './plugin-css/css-parse-guard-loader.ts'
  ),
  'dead-css-url-loader': path.resolve(
    __dirname,
    './plugin-css/dead-css-url-loader.ts'
  ),
  'sfc-style-block-loader': path.resolve(
    __dirname,
    './plugin-css/sfc-style-block-loader.ts'
  ),
  'late-css-import-loader': path.resolve(
    __dirname,
    './plugin-css/late-css-import-loader.ts'
  ),
  'unplaced-style-import-loader': path.resolve(
    __dirname,
    './plugin-css/unplaced-style-import-loader.ts'
  ),
  'public-css-url-loader': path.resolve(
    __dirname,
    './plugin-css/public-css-url-loader.ts'
  ),
  'preprocessor-passthrough-loader': path.resolve(
    __dirname,
    './plugin-css/preprocessor-passthrough-loader.ts'
  ),
  'solid-jsx-gate-loader': path.resolve(
    __dirname,
    './plugin-js-frameworks/js-tools/solid-jsx-gate-loader.ts'
  ),
  'env-write-loader': path.resolve(
    __dirname,
    './plugin-compilation/env-write-loader.ts'
  )
}

export default defineConfig({
  tools: {
    // Disable caching to avoid rspack module graph panics in CI builds.
    rspack: {cache: false}
  },
  lib: [
    {
      format: 'esm',
      syntax: 'es2022',
      dts: shouldGenerateDts,
      source: {entry: nodeEntries},
      // Bundled require() and __dirname sites need CJS globals in ESM output.
      // Node lib only, so browser entries never import node:module.
      shims: {esm: {require: true, __dirname: true, __filename: true}},
      output: {
        target: 'node',
        filename: {js: '[name].mjs'},
        // Ship the contract JSON (schema plus any golden envelopes) so the MCP
        // can byte-compare against node_modules/extension-develop/dist/contract.
        copy: [
          {
            from: contractDir,
            to: 'contract',
            globOptions: {ignore: ['**/*.ts']}
          }
        ],
        externals
      }
    },
    {
      format: 'esm',
      syntax: 'es2022',
      source: {entry: browserEntries},
      output: {
        target: 'web',
        filename: {js: '[name].mjs'},
        externals
      }
    },
    {
      format: 'esm',
      syntax: 'es2022',
      // No dts here: the node lib's pass already emits every declaration, and
      // a second pass would rewrite the same files while the first still runs.
      source: {entry: contractsEntries},
      output: {
        target: 'web',
        filename: {js: '[name].mjs'}
      }
    }
  ]
} satisfies RslibConfig)
