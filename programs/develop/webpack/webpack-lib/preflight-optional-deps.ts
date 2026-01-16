// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import {getDirs} from './paths'
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

function canResolveFromProject(id: string, projectPath: string) {
  try {
    return require.resolve(id, {paths: [projectPath, process.cwd()]})
  } catch {
    return undefined
  }
}

function canResolve(id: string) {
  try {
    return require.resolve(id)
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

  if (usesTypeScript && !canResolveFromProject('typescript', projectPath)) {
    missingOptionalDeps.add('typescript')
    usedIntegrations.push('TypeScript')
  }

  if (usesReact) {
    if (!canResolve('react-refresh')) missingOptionalDeps.add('react-refresh')
    if (!canResolve('@rspack/plugin-react-refresh')) {
      missingOptionalDeps.add('@rspack/plugin-react-refresh')
    }
    usedIntegrations.push('React')
  }

  if (usesPreact) {
    if (!canResolve('@prefresh/core')) missingOptionalDeps.add('@prefresh/core')
    if (!canResolve('@prefresh/utils'))
      missingOptionalDeps.add('@prefresh/utils')
    if (!canResolve('@rspack/plugin-preact-refresh')) {
      missingOptionalDeps.add('@rspack/plugin-preact-refresh')
    }
    if (!canResolve('preact')) missingOptionalDeps.add('preact')
    usedIntegrations.push('Preact')
  }

  if (usesVue) {
    if (!canResolve('vue-loader')) missingOptionalDeps.add('vue-loader')
    if (!canResolve('@vue/compiler-sfc')) {
      missingOptionalDeps.add('@vue/compiler-sfc')
    }
    usedIntegrations.push('Vue')
  }

  if (usesSvelte) {
    if (
      !canResolveFromProject('svelte-loader', projectPath) &&
      !canResolve('svelte-loader')
    ) {
      missingOptionalDeps.add('svelte-loader')
    }
    if (!canResolveFromProject('typescript', projectPath)) {
      missingOptionalDeps.add('typescript')
    }
    usedIntegrations.push('Svelte')
  }

  if (usesSass && !canResolve('sass-loader')) {
    const postCssDeps = ['postcss-loader', 'postcss-scss', 'postcss-preset-env']
    for (const dep of postCssDeps) {
      if (!canResolve(dep)) missingOptionalDeps.add(dep)
    }
    missingOptionalDeps.add('sass-loader')
    usedIntegrations.push('Sass')
  }

  if (usesLess && !canResolve('less-loader')) {
    if (!canResolve('less')) missingOptionalDeps.add('less')
    missingOptionalDeps.add('less-loader')
    usedIntegrations.push('Less')
  }

  if (usesPostCss && !canResolve('postcss-loader') && !usesSass && !usesLess) {
    if (!canResolve('postcss')) missingOptionalDeps.add('postcss')
    missingOptionalDeps.add('postcss-loader')
    usedIntegrations.push('PostCSS')
  }

  if (missingOptionalDeps.size > 0) {
    await installOptionalDependenciesBatch(
      'Optional',
      Array.from(missingOptionalDeps)
    )
    if (opts?.showRunAgainMessage !== false) {
      const uniqueIntegrations = Array.from(new Set(usedIntegrations))
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
  return !hasPreflightMarker(projectPath)
}
