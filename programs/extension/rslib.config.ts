//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import {createRequire} from 'node:module'
import * as path from 'node:path'
import type {RslibConfig} from '@rslib/core'
import {defineConfig} from '@rslib/core'
import colors from 'pintor'
// @ts-expect-error plain ESM script without types, shared with the README sync workflow
import {syncNpmReadme} from '../../scripts/sync-npm-readme.mjs'

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

function copyReadmePlugin() {
  return {
    name: 'copy-readme',
    setup(api: {onAfterBuild: (cb: () => void) => void}) {
      api.onAfterBuild(() => {
        const {stale, target} = syncNpmReadme()

        // An unchanged README is the usual case and says nothing.
        if (!stale) return

        console.log(
          `${colors.gray('⏵⏵⏵ system')} [Extension.js setup] File README.md copied to ${target}`
        )
      })
    }
  }
}

export default defineConfig({
  source: {
    entry: {
      cli: path.resolve(__dirname, './index.ts'),
      browsers: path.resolve(__dirname, './browsers/index.ts')
    }
  },
  lib: [
    {
      format: 'cjs',
      syntax: 'es2021',
      dts: shouldGenerateDts
    }
  ],
  plugins: [copyReadmePlugin()]
} satisfies RslibConfig)
