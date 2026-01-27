// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import {getDirs} from './paths'
import {findExtensionDevelopRoot} from './check-build-dependencies'
import colors from 'pintor'
import {hasPreflightMarker, writePreflightMarker} from './preflight-cache'
import type {ProjectStructure} from './project'
import type {DevOptions} from '../webpack-types'
import {isUsingReact} from '../plugin-js-frameworks/js-tools/react'
import {isUsingPreact} from '../plugin-js-frameworks/js-tools/preact'
import {isUsingVue} from '../plugin-js-frameworks/js-tools/vue'
import {isUsingSvelte} from '../plugin-js-frameworks/js-tools/svelte'
import {isUsingTypeScript} from '../plugin-js-frameworks/js-tools/typescript'
import {installOptionalDependenciesBatch} from '../plugin-js-frameworks/frameworks-lib/integrations'
import {isUsingSass} from '../plugin-css/css-tools/sass'
import {isUsingLess} from '../plugin-css/css-tools/less'
import {isUsingPostCss} from '../plugin-css/css-tools/postcss'
import * as messages from '../plugin-js-frameworks/js-frameworks-lib/messages'

function getResolutionPaths(projectPath?: string) {
  const extensionRoot = findExtensionDevelopRoot()
  const paths = [
    projectPath || undefined,
    extensionRoot || undefined,
    process.cwd()
  ].filter(Boolean) as string[]

  return Array.from(new Set(paths))
}

function canResolveFromProject(id: string, projectPath: string) {
  try {
    return require.resolve(id, {paths: getResolutionPaths(projectPath)})
  } catch {
    return undefined
  }
}

function canResolve(id: string, projectPath?: string) {
  try {
    return require.resolve(id, {paths: getResolutionPaths(projectPath)})
  } catch {
    return undefined
  }
}

export async function preflightOptionalDependencies(
  projectStructure: ProjectStructure,
  mode: DevOptions['mode'],
  opts?: {
    exitOnInstall?: boolean
    showRunAgainMessage?: boolean
  }
) {
  const {packageJsonDir} = getDirs(projectStructure)
  const projectPath = packageJsonDir as string

  if (hasPreflightMarker(projectPath)) {
    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      console.log(
        `${colors.brightMagenta('►►► Author says')} Optional deps preflight skipped (cache hit).`
      )
    }
    return
  }

  const missingOptionalDeps = new Set<string>()
  const usedIntegrations: string[] = []

  const usesTypeScript = isUsingTypeScript(projectPath)
  const usesReact = isUsingReact(projectPath)
  const usesPreact = isUsingPreact(projectPath)
  const usesVue = isUsingVue(projectPath)
  const usesSvelte = isUsingSvelte(projectPath)
  const usesSass = isUsingSass(projectPath)
  const usesLess = isUsingLess(projectPath)
  const usesPostCss = isUsingPostCss(projectPath)

  if (usesTypeScript) {
    if (!canResolveFromProject('typescript', projectPath)) {
      missingOptionalDeps.add('typescript')
      usedIntegrations.push('TypeScript')
    }
  }

  if (usesReact) {
    if (!canResolve('react-refresh', projectPath)) {
      missingOptionalDeps.add('react-refresh')
    }
    if (!canResolve('@rspack/plugin-react-refresh', projectPath)) {
      missingOptionalDeps.add('@rspack/plugin-react-refresh')
    }
    usedIntegrations.push('React')
  }

  if (usesPreact) {
    if (!canResolve('@prefresh/core', projectPath)) {
      missingOptionalDeps.add('@prefresh/core')
    }
    if (!canResolve('@prefresh/utils', projectPath)) {
      missingOptionalDeps.add('@prefresh/utils')
    }
    if (!canResolve('@rspack/plugin-preact-refresh', projectPath)) {
      missingOptionalDeps.add('@rspack/plugin-preact-refresh')
    }
    if (!canResolve('preact', projectPath)) {
      missingOptionalDeps.add('preact')
    }
    usedIntegrations.push('Preact')
  }

  if (usesVue) {
    if (!canResolve('vue-loader', projectPath)) {
      missingOptionalDeps.add('vue-loader')
    }
    if (!canResolve('@vue/compiler-sfc', projectPath)) {
      missingOptionalDeps.add('@vue/compiler-sfc')
    }
    usedIntegrations.push('Vue')
  }

  if (usesSvelte) {
    if (
      !canResolveFromProject('svelte-loader', projectPath) &&
      !canResolve('svelte-loader', projectPath)
    ) {
      missingOptionalDeps.add('svelte-loader')
    }
    if (!canResolveFromProject('typescript', projectPath)) {
      missingOptionalDeps.add('typescript')
    }
    usedIntegrations.push('Svelte')
  }

  if (usesSass) {
    if (!canResolve('sass-loader', projectPath)) {
      const postCssDeps = [
        'postcss-loader',
        'postcss-scss',
        'postcss-preset-env'
      ]
      for (const dep of postCssDeps) {
        if (!canResolve(dep, projectPath)) {
          missingOptionalDeps.add(dep)
        }
      }
      missingOptionalDeps.add('sass-loader')
      usedIntegrations.push('Sass')
    }
  }

  if (usesLess) {
    if (!canResolve('less-loader', projectPath)) {
      if (!canResolve('less', projectPath)) {
        missingOptionalDeps.add('less')
      }
      missingOptionalDeps.add('less-loader')
      usedIntegrations.push('Less')
    }
  }

  if (
    usesPostCss &&
    !canResolve('postcss-loader', projectPath) &&
    !usesSass &&
    !usesLess
  ) {
    if (!canResolve('postcss', projectPath)) {
      missingOptionalDeps.add('postcss')
    }
    missingOptionalDeps.add('postcss-loader')
    usedIntegrations.push('PostCSS')
  } else if (usesPostCss) {
    usedIntegrations.push('PostCSS')
  }

  if (missingOptionalDeps.size > 0) {
    const uniqueIntegrations = Array.from(new Set(usedIntegrations))
    const didInstall = await installOptionalDependenciesBatch(
      'Optional',
      Array.from(missingOptionalDeps),
      uniqueIntegrations
    )

    if (!didInstall) {
      throw new Error('[Optional] Optional dependencies failed to install.')
    }
    if (
      opts?.showRunAgainMessage !== false &&
      process.env.EXTENSION_AUTHOR_MODE === 'true'
    ) {
      console.log(messages.optionalDepsReady(uniqueIntegrations))
    }
    if (opts?.exitOnInstall !== false) {
      process.exit(0)
    }
  }

  writePreflightMarker(projectPath)
}

export function shouldRunOptionalPreflight(projectStructure: ProjectStructure) {
  const {packageJsonDir} = getDirs(projectStructure)
  const projectPath = packageJsonDir as string

  if (hasPreflightMarker(projectPath)) {
    return false
  } else {
    return true
  }
}
