//      ██╗███████╗      ███████╗██████╗  █████╗ ███╗   ███╗███████╗██╗    ██╗ ██████╗ ██████╗ ██╗  ██╗███████╗
//      ██║██╔════╝      ██╔════╝██╔══██╗██╔══██╗████╗ ████║██╔════╝██║    ██║██╔═══██╗██╔══██╗██║ ██╔╝██╔════╝
//      ██║███████╗█████╗█████╗  ██████╔╝███████║██╔████╔██║█████╗  ██║ █╗ ██║██║   ██║██████╔╝█████╔╝ ███████╗
// ██   ██║╚════██║╚════╝██╔══╝  ██╔══██╗██╔══██║██║╚██╔╝██║██╔══╝  ██║███╗██║██║   ██║██╔══██╗██╔═██╗ ╚════██║
// ╚█████╔╝███████║      ██║     ██║  ██║██║  ██║██║ ╚═╝ ██║███████╗╚███╔███╔╝╚██████╔╝██║  ██║██║  ██╗███████║
//  ╚════╝ ╚══════╝      ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝ ╚══╝╚══╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {createRequire} from 'node:module'
import * as path from 'node:path'
import colors from 'pintor'
import type {JsFramework} from '../../types'
import {hasDependency} from '../frameworks-lib/integrations'
import * as messages from '../js-frameworks-lib/messages'

let userMessageDelivered = false

export function isUsingPreact(projectPath: string) {
  if (hasDependency(projectPath, 'preact')) {
    if (!userMessageDelivered) {
      if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
        console.log(
          `${colors.brightMagenta('⏵⏵⏵ Author says')} ${messages.isUsingIntegration('Preact')}`
        )
      }

      userMessageDelivered = true
    }
    return true
  }

  return false
}

export async function maybeUsePreact(
  projectPath: string
): Promise<JsFramework | undefined> {
  if (!isUsingPreact(projectPath)) return undefined

  // Preact fast-refresh is intentionally disabled, Preact falls back to full
  // live-reload in dev (the app still mounts and updates on change; it just
  // doesn't preserve component state across edits).
  //
  // Why: @rspack/plugin-preact-refresh@2.0.1 (the only rspack-2.x-native
  // release) vendors a @prefresh/webpack runtime module that references the
  // bare CJS `module` symbol (`__prefresh_utils__.shouldBind(module)`). rspack
  // 2.x's module-argument optimization decides that runtime module doesn't use
  // `module`. The reference is loader-injected, so rspack's parser never sees
  // it, and renames the factory parameter to
  // `__unused_rspack___webpack_module__`. At eval the runtime hits
  // `module is not defined`, which throws before the app (and the injected
  // live-reload client) can run, so the Preact page never mounts in dev and
  // never reloads. It is not fixable from our config: the renaming lives in
  // rspack's native binding (no `optimization.*` toggle disables it) and
  // reproduces on every rspack 2.x (verified 2.0.8 through 2.1.x). React is
  // unaffected because @rspack/plugin-react-refresh isn't authored this way.
  //
  // To restore fast-refresh once upstream is fixed, re-add the
  // PreactRefreshPlugin resolve/load/apply block (see git history for this
  // file) and bump the bundled plugin/rspack. The `preact: dev html` e2e gate
  // in extension-js/examples confirms when it's safe.
  // Upstream: TODO, file against rspack / @rspack/plugin-preact-refresh.

  const requireFromProject = createRequire(
    path.join(projectPath, 'package.json')
  )
  const resolveFromProject = (id: string) => {
    try {
      return requireFromProject.resolve(id)
    } catch {
      return undefined
    }
  }

  const preactPkgJson = resolveFromProject('preact/package.json')
  const preactDir = preactPkgJson ? path.dirname(preactPkgJson) : undefined
  const preactCompat = resolveFromProject('preact/compat')
  const preactTestUtils = resolveFromProject('preact/test-utils')
  const preactJsxRuntime = resolveFromProject('preact/jsx-runtime')
  const preactJsxDevRuntime = resolveFromProject('preact/jsx-dev-runtime')

  const alias: Record<string, string> = {}

  // Alias `preact` to the project-resolved package directory (not the entry
  // file, webpack treats the value as a prefix for sub-paths like
  // `preact/hooks`). Without this, pnpm strict layouts can leave `preact`
  // unresolvable for `preact/compat` sub-imports.
  if (preactDir) {
    alias.preact = preactDir
  }

  if (preactCompat) {
    alias.react = preactCompat
    alias['react-dom'] = preactCompat
  }

  if (preactTestUtils) {
    alias['react-dom/test-utils'] = preactTestUtils
  }

  if (preactJsxRuntime) {
    alias['react/jsx-runtime'] = preactJsxRuntime
  }

  if (preactJsxDevRuntime) {
    alias['react/jsx-dev-runtime'] = preactJsxDevRuntime
  }

  return {
    // No fast-refresh plugin (see the disabled-fast-refresh note above); Preact
    // relies on live-reload plus the alias map below.
    plugins: [],
    loaders: undefined,
    alias
  }
}
