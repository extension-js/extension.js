// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import * as fs from 'fs'
import {createRequire} from 'module'
import {getDirs} from './paths'
import {
  resolveDevelopInstallRoot,
  resolveOptionalInstallRoot
} from '../optional-deps-lib'
import colors from 'pintor'
import {hasPreflightMarker, writePreflightMarker} from './preflight-cache'
import type {ProjectStructure} from './project'
import type {DevOptions} from '../webpack-types'
import {getOptionalDependencyContract} from './optional-deps-contracts'
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
import {
  getContractVerificationFailuresAtInstallRoot,
  getContractVerificationFailuresFromKnownLocations
} from './optional-deps-resolver'

function getResolutionPaths(projectPath?: string) {
  const optionalInstallRoot = resolveOptionalInstallRoot()
  const extensionRoot = resolveDevelopInstallRoot()
  const paths = [
    projectPath || undefined,
    optionalInstallRoot && fs.existsSync(optionalInstallRoot)
      ? optionalInstallRoot
      : undefined,
    extensionRoot || undefined,
    process.cwd()
  ].filter(Boolean) as string[]

  if (optionalInstallRoot && optionalInstallRoot.includes('.pnpm')) {
    paths.push(path.join(optionalInstallRoot, '..', '..'))
  }

  // In pnpm dlx, optional deps live in extension-develop's sibling node_modules
  if (extensionRoot && extensionRoot.includes('.pnpm')) {
    paths.push(path.join(extensionRoot, '..', '..'))
  }

  return Array.from(new Set(paths))
}

function canResolveFromModuleContext(
  resolvedPath: string | undefined,
  dependencyId: string
) {
  if (!resolvedPath) return undefined

  try {
    const req = createRequire(resolvedPath)
    return req.resolve(dependencyId)
  } catch {
    return undefined
  }
}

function isPathInside(basePath: string, candidatePath: string) {
  const relative = path.relative(path.resolve(basePath), path.resolve(candidatePath))
  return !relative.startsWith('..') && !path.isAbsolute(relative)
}

function verifyOptionalDepsResolvedAtInstallRoot(dependencies: string[]) {
  const installRoot = resolveOptionalInstallRoot()
  const req = createRequire(path.join(installRoot, 'package.json'))
  const missing = dependencies.filter((dependencyId) => {
    try {
      const resolvedPath = req.resolve(dependencyId)
      return !isPathInside(installRoot, resolvedPath)
    } catch {
      return true
    }
  })

  if (missing.length === 0) return

  throw new Error(
    `[Optional] Optional dependency install reported success but packages are missing at install root: ${missing.join(', ')}`
  )
}

function getInstallRootVerificationFailures(contractIds: string[]) {
  return Array.from(
    new Set(
      contractIds.flatMap((contractId) =>
        getContractVerificationFailuresAtInstallRoot(
          getOptionalDependencyContract(contractId)
        )
      )
    )
  )
}

async function verifyContractsResolvedAtInstallRoot(contractIds: string[]) {
  let failures = getInstallRootVerificationFailures(contractIds)
  if (failures.length === 0) return

  for (const waitMs of [250, 500, 1000]) {
    await new Promise((resolve) => setTimeout(resolve, waitMs))
    failures = getInstallRootVerificationFailures(contractIds)
    if (failures.length === 0) return
  }

  throw new Error(
    `[Optional] Optional dependency install reported success but contract verification failed at install root: ${failures.join(', ')}`
  )
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
  const activeContractIds: string[] = []
  const contractsNeedingInstall: string[] = []

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

    contractsNeedingInstall.push(contractId)
    for (const dependency of contract.installPackages) {
      addMissing(contract.integration, dependency)
    }
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

    await verifyContractsResolvedAtInstallRoot(
      Array.from(new Set(contractsNeedingInstall))
    )

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
