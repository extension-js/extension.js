// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Compiler, RuleSetRule} from '@rspack/core'
import {resolveDevelopInstallRoot} from './develop-context'

// Production module ids are a hash of each module's full identifier, which
// names every loader by its resolved path relative to the project root. A
// loader that lives outside the project (a linked extension-develop checkout,
// a pnpm store entry) puts its own location into that hash, so the same
// source and lockfile built from another folder came out with other ids.
// Naming the loader through the project's own node_modules keeps the hash a
// function of the project alone wherever the package really sits.

const NODE_MODULES_SEGMENT = '/node_modules/'

interface PackageLocation {
  name: string
  inside: string
}

function toPosix(value: string): string {
  return value.split(path.sep).join('/')
}

function isInside(dir: string, file: string): boolean {
  const relative = path.relative(dir, file)

  return (
    relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
  )
}

function sameFile(a: string, b: string): boolean {
  try {
    return fs.realpathSync.native(a) === fs.realpathSync.native(b)
  } catch {
    return false
  }
}

// The package a loader file belongs to and its path inside that package:
// read off the last node_modules segment, or off extension-develop's own root
// when the loader is one of its files in a checkout that has no such segment.
export function locateLoaderPackage(
  loaderPath: string,
  developRoot?: string
): PackageLocation | undefined {
  const posix = toPosix(loaderPath)
  const marker = posix.lastIndexOf(NODE_MODULES_SEGMENT)

  if (marker !== -1) {
    const segments = posix
      .slice(marker + NODE_MODULES_SEGMENT.length)
      .split('/')
    const scoped = segments[0]?.startsWith('@')
    const name = scoped ? segments.slice(0, 2).join('/') : segments[0]
    const inside = segments.slice(scoped ? 2 : 1).join('/')

    if (name && inside) return {name, inside}
  }

  if (developRoot && isInside(developRoot, loaderPath)) {
    return {
      name: 'extension-develop',
      inside: toPosix(path.relative(developRoot, loaderPath))
    }
  }

  return undefined
}

// The same loader file named through the project's node_modules when a path
// there resolves to it; the original path otherwise.
export function projectLocalLoaderPath(
  loaderPath: string,
  projectRoot: string,
  developRoot: string | undefined = resolveDevelopInstallRoot()
): string {
  if (!path.isAbsolute(loaderPath)) return loaderPath

  const located = locateLoaderPackage(loaderPath, developRoot)

  if (!located) return loaderPath

  const candidates = [
    path.join(projectRoot, 'node_modules', located.name, located.inside),
    path.join(
      projectRoot,
      'node_modules',
      '.pnpm',
      'node_modules',
      located.name,
      located.inside
    )
  ]

  for (const candidate of candidates) {
    if (candidate === loaderPath) return loaderPath
    if (sameFile(candidate, loaderPath)) return candidate
  }

  return loaderPath
}

type Rewrite = (loaderPath: string) => string

function rewriteUse(use: unknown, rewrite: Rewrite): unknown {
  if (typeof use === 'string') return rewrite(use)
  if (Array.isArray(use)) return use.map((entry) => rewriteUse(entry, rewrite))

  if (use && typeof use === 'object') {
    const entry = use as {loader?: unknown}

    if (typeof entry.loader === 'string') entry.loader = rewrite(entry.loader)
  }

  return use
}

// Rewrites every loader path in the rule tree in place, so the rule objects
// the plugins still hold keep describing the same rules.
export function rewriteRuleLoaderPaths(rules: unknown, rewrite: Rewrite): void {
  if (!Array.isArray(rules)) return

  for (const rule of rules as Array<RuleSetRule | '...' | null | undefined>) {
    if (!rule || typeof rule !== 'object') continue

    if (typeof rule.loader === 'string') rule.loader = rewrite(rule.loader)

    if (rule.use !== undefined && typeof rule.use !== 'function') {
      rule.use = rewriteUse(rule.use, rewrite) as NonNullable<
        RuleSetRule['use']
      >
    }

    rewriteRuleLoaderPaths(rule.oneOf, rewrite)
    rewriteRuleLoaderPaths(rule.rules, rewrite)
  }
}

// Runs once every plugin has attached its rules and before the bundler reads
// them, the same moment the configResolved hook gets. Applied last for that.
export class StableLoaderPathsPlugin {
  public static readonly name: string = 'plugin-stable-loader-paths'

  apply(compiler: Compiler) {
    const run = () => {
      const projectRoot = compiler.options.context

      if (typeof projectRoot !== 'string' || !projectRoot) return

      const developRoot = resolveDevelopInstallRoot()
      const seen = new Map<string, string>()

      const rewrite: Rewrite = (loaderPath) => {
        let local = seen.get(loaderPath)

        if (local === undefined) {
          local = projectLocalLoaderPath(loaderPath, projectRoot, developRoot)
          seen.set(loaderPath, local)
        }

        return local
      }

      rewriteRuleLoaderPaths(compiler.options.module?.rules, rewrite)
    }

    compiler.hooks.beforeRun.tap(StableLoaderPathsPlugin.name, run)
    compiler.hooks.watchRun.tap(StableLoaderPathsPlugin.name, run)
  }
}
