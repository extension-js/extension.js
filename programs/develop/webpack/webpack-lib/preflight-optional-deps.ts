// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import colors from 'pintor'
import {isUsingLess} from '../plugin-css/css-tools/less'
import {isUsingPostCss} from '../plugin-css/css-tools/postcss'
import {isUsingSass} from '../plugin-css/css-tools/sass'
import {isUsingPreact} from '../plugin-js-frameworks/js-tools/preact'
import {isUsingReact} from '../plugin-js-frameworks/js-tools/react'
import {isUsingSvelte} from '../plugin-js-frameworks/js-tools/svelte'
import {isUsingTypeScript} from '../plugin-js-frameworks/js-tools/typescript'
import {isUsingVue} from '../plugin-js-frameworks/js-tools/vue'
import type {DevOptions} from '../webpack-types'
import {getOptionalDependencyContract} from './optional-deps-contracts'
import {getContractVerificationFailuresFromKnownLocations} from './optional-deps-resolver'
import {getDirs} from './paths'
import {hasPreflightMarker, writePreflightMarker} from './preflight-cache'
import type {ProjectStructure} from './project'

export async function preflightOptionalDependencies(
  projectStructure: ProjectStructure,
  _mode: DevOptions['mode'],
  _opts?: {
    exitOnInstall?: boolean
    showRunAgainMessage?: boolean
  }
) {
  const {packageJsonDir} = getDirs(projectStructure)
  const projectPath = packageJsonDir as string

  if (hasPreflightMarker(projectPath)) {
    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      console.log(
        `${colors.brightMagenta('⏵⏵⏵ Author says')} Optional deps preflight skipped (cache hit).`
      )
    }
    return
  }

  const usedIntegrations: string[] = []
  const activeContractIds: string[] = []

  const addActiveContract = (contractId: string) => {
    activeContractIds.push(contractId)
    usedIntegrations.push(getOptionalDependencyContract(contractId).integration)
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
    addActiveContract('typescript')
  }

  if (usesReact) {
    addActiveContract('react-refresh')
  }

  if (usesPreact) {
    addActiveContract('preact-refresh')
  }

  if (usesVue) {
    addActiveContract('vue')
  }

  if (usesSvelte) {
    addActiveContract('svelte')
  }

  if (usesSass) {
    addActiveContract('sass')
  }

  if (usesLess) {
    addActiveContract('less')
  }

  if (usesPostCss && !usesSass && !usesLess) {
    addActiveContract('postcss')
  } else if (usesPostCss) {
    usedIntegrations.push('PostCSS')
  }

  for (const contractId of Array.from(new Set(activeContractIds))) {
    const contract = getOptionalDependencyContract(contractId)
    const failures = getContractVerificationFailuresFromKnownLocations(
      contract,
      projectPath
    )

    if (failures.length === 0) continue

    throw new Error(
      `[Optional] Toolchain packages are missing or incompatible for ${contract.integration}. ` +
        `Expected: ${failures.join(', ')}. ` +
        `Reinstall extension-develop or add the missing packages to your extension project.`
    )
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
