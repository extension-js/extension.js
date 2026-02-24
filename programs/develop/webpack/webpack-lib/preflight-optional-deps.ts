// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import {getDirs} from './paths'
import {resolveDevelopInstallRoot} from '../plugin-css/css-lib/integrations'
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
  const extensionRoot = resolveDevelopInstallRoot()
  const paths = [
    projectPath || undefined,
    extensionRoot || undefined,
    process.cwd()
  ].filter(Boolean) as string[]

  // In pnpm dlx, optional deps live in extension-develop's sibling node_modules
  if (extensionRoot && extensionRoot.includes('.pnpm')) {
    paths.push(path.join(extensionRoot, '..', '..'))
  }

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
  const missingByIntegration: Record<string, string[]> = {}
  const usedIntegrations: string[] = []

  const addMissing = (integration: string, dependency: string) => {
    if (missingOptionalDeps.has(dependency)) {
      return
    }
    missingOptionalDeps.add(dependency)
    if (!missingByIntegration[integration]) {
      missingByIntegration[integration] = []
    }
    missingByIntegration[integration].push(dependency)
  }

  const usesTypeScript = isUsingTypeScript(projectPath)
  const usesReact = isUsingReact(projectPath)
  const usesPreact = isUsingPreact(projectPath)
  const usesVue = isUsingVue(projectPath)
  const usesSvelte = isUsingSvelte(projectPath)
  const usesSass = isUsingSass(projectPath)
  const usesLess = isUsingLess(projectPath)
  const usesPostCss = isUsingPostCss(projectPath)

  if (usesTypeScript) {
    usedIntegrations.push('TypeScript')
    if (!canResolveFromProject('typescript', projectPath)) {
      addMissing('TypeScript', 'typescript')
    }
  }

  if (usesReact) {
    if (!canResolve('react-refresh', projectPath)) {
      addMissing('React', 'react-refresh')
    }
    if (!canResolve('@rspack/plugin-react-refresh', projectPath)) {
      addMissing('React', '@rspack/plugin-react-refresh')
    }
    usedIntegrations.push('React')
  }

  if (usesPreact) {
    if (!canResolve('@prefresh/core', projectPath)) {
      addMissing('Preact', '@prefresh/core')
    }
    if (!canResolve('@prefresh/utils', projectPath)) {
      addMissing('Preact', '@prefresh/utils')
    }
    if (!canResolve('@rspack/plugin-preact-refresh', projectPath)) {
      addMissing('Preact', '@rspack/plugin-preact-refresh')
    }
    if (!canResolve('preact', projectPath)) {
      addMissing('Preact', 'preact')
    }
    usedIntegrations.push('Preact')
  }

  if (usesVue) {
    if (!canResolve('vue-loader', projectPath)) {
      addMissing('Vue', 'vue-loader')
    }
    if (!canResolve('@vue/compiler-sfc', projectPath)) {
      addMissing('Vue', '@vue/compiler-sfc')
    }
    usedIntegrations.push('Vue')
  }

  if (usesSvelte) {
    if (
      !canResolveFromProject('svelte-loader', projectPath) &&
      !canResolve('svelte-loader', projectPath)
    ) {
      addMissing('Svelte', 'svelte-loader')
    }
    if (!canResolveFromProject('typescript', projectPath)) {
      addMissing('Svelte', 'typescript')
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
          addMissing('Sass', dep)
        }
      }
      addMissing('Sass', 'sass-loader')
      usedIntegrations.push('Sass')
    }
  }

  if (usesLess) {
    if (!canResolve('less-loader', projectPath)) {
      if (!canResolve('less', projectPath)) {
        addMissing('Less', 'less')
      }
      addMissing('Less', 'less-loader')
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
      addMissing('PostCSS', 'postcss')
    }
    addMissing('PostCSS', 'postcss-loader')
    usedIntegrations.push('PostCSS')
  } else if (usesPostCss) {
    usedIntegrations.push('PostCSS')
  }

  if (missingOptionalDeps.size > 0) {
    const uniqueIntegrations = Array.from(new Set(usedIntegrations))
    const installPlans = uniqueIntegrations
      .map((integration) => ({
        integration,
        dependencies: missingByIntegration[integration] || []
      }))
      .filter((plan) => plan.dependencies.length > 0)
    const didInstall = await installOptionalDependenciesBatch(installPlans)

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
      writePreflightMarker(projectPath)
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
