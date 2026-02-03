//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as fs from 'fs'
import * as path from 'path'
import {createRequire} from 'module'
import * as messages from '../lib/messages'
import {detectPackageManagerFromEnv} from '../lib/package-manager'
import {shouldShowProgress, startProgressBar} from '../lib/progress'
import {runInstall} from '../lib/install-runner'

const requireFromCreate = createRequire(import.meta.url)

type PackageJson = {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

type OptionalDepsPlan = {
  integrations: string[]
  dependencies: string[]
}

type BuildDepsPlan = {
  dependencies: string[]
  dependencyMap: Record<string, string>
}

function resolveDevelopRoot(projectPath: string): string | null {
  const override = process.env.EXTENSION_CREATE_DEVELOP_ROOT
  if (override) return override

  try {
    const localPkgPath = path.join(
      projectPath,
      'node_modules',
      'extension-develop',
      'package.json'
    )
    if (fs.existsSync(localPkgPath)) {
      return path.dirname(localPkgPath)
    }

    const pkgPath = requireFromCreate.resolve(
      'extension-develop/package.json',
      {
        paths: [projectPath, process.cwd(), __dirname]
      }
    )

    return path.dirname(pkgPath)
  } catch {
    return null
  }
}

function resolveBuildDepsPath(developRoot: string): string {
  return path.join(
    developRoot,
    'webpack',
    'webpack-lib',
    'build-dependencies.json'
  )
}

function loadBuildDependencies(developRoot: string): Record<string, string> {
  const metadataPath = resolveBuildDepsPath(developRoot)
  if (!fs.existsSync(metadataPath)) {
    console.warn(
      `${messages.installingBuildDependencies([])} ` +
        '(build-dependencies.json missing; skipping build deps install)'
    )
    return {
      // Do nothing
    }
  }

  return JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
}

function readPackageJson(projectPath: string): PackageJson {
  try {
    const raw = fs.readFileSync(path.join(projectPath, 'package.json'), 'utf8')
    return JSON.parse(raw)
  } catch {
    return {
      // Do nothing
    }
  }
}

function hasDependency(pkg: PackageJson, name: string): boolean {
  return Boolean(pkg.dependencies?.[name] || pkg.devDependencies?.[name])
}

function canResolve(dependency: string, paths: string[]): boolean {
  try {
    requireFromCreate.resolve(dependency, {paths})
    return true
  } catch {
    return false
  }
}

function findConfigFile(projectPath: string, candidates: string[]): boolean {
  return candidates.some((file) => fs.existsSync(path.join(projectPath, file)))
}

function detectOptionalDependencies(projectPath: string): OptionalDepsPlan {
  const pkg = readPackageJson(projectPath)

  const usesReact =
    hasDependency(pkg, 'react') || hasDependency(pkg, 'react-dom')
  const usesPreact = hasDependency(pkg, 'preact')
  const usesVue = hasDependency(pkg, 'vue')
  const usesSvelte = hasDependency(pkg, 'svelte')

  const hasTsConfig = fs.existsSync(path.join(projectPath, 'tsconfig.json'))
  const usesTypeScript = hasDependency(pkg, 'typescript') || hasTsConfig

  const usesSass =
    hasDependency(pkg, 'sass') || hasDependency(pkg, 'sass-loader')
  const usesLess =
    hasDependency(pkg, 'less') || hasDependency(pkg, 'less-loader')

  const postCssConfigFiles = [
    '.postcssrc',
    '.postcssrc.json',
    '.postcssrc.yaml',
    '.postcssrc.yml',
    'postcss.config.mjs',
    '.postcssrc.js',
    '.postcssrc.cjs',
    'postcss.config.js',
    'postcss.config.cjs'
  ]
  const tailwindConfigFiles = [
    'tailwind.config.mjs',
    'tailwind.config.cjs',
    'tailwind.config.js'
  ]
  const usesPostCss =
    hasDependency(pkg, 'postcss') ||
    hasDependency(pkg, 'postcss-loader') ||
    findConfigFile(projectPath, postCssConfigFiles) ||
    hasDependency(pkg, 'tailwindcss') ||
    hasDependency(pkg, '@tailwindcss/postcss') ||
    findConfigFile(projectPath, tailwindConfigFiles)

  const integrations = new Set<string>()
  const deps = new Set<string>()

  if (usesTypeScript) {
    integrations.add('TypeScript')
    deps.add('typescript')
  }

  if (usesReact) {
    integrations.add('React')
    deps.add('react-refresh')
    deps.add('@rspack/plugin-react-refresh')
  }

  if (usesPreact) {
    integrations.add('Preact')
    deps.add('@prefresh/core')
    deps.add('@prefresh/utils')
    deps.add('@rspack/plugin-preact-refresh')
    deps.add('preact')
  }

  if (usesVue) {
    integrations.add('Vue')
    deps.add('vue-loader')
    deps.add('@vue/compiler-sfc')
  }

  if (usesSvelte) {
    integrations.add('Svelte')
    deps.add('svelte-loader')
    deps.add('typescript')
  }

  if (usesSass) {
    integrations.add('Sass')
    deps.add('sass-loader')
    deps.add('postcss-loader')
    deps.add('postcss-scss')
    deps.add('postcss-preset-env')
  }

  if (usesLess) {
    integrations.add('Less')
    deps.add('less')
    deps.add('less-loader')
  }

  if (usesPostCss && !usesSass && !usesLess) {
    integrations.add('PostCSS')
    deps.add('postcss')
    deps.add('postcss-loader')
  } else if (usesPostCss) {
    integrations.add('PostCSS')
  }

  return {
    integrations: Array.from(integrations),
    dependencies: Array.from(deps)
  }
}

function buildOptionalInstallArgs(
  pm: string,
  dependencies: string[],
  installDir: string
) {
  if (pm === 'yarn') {
    return ['add', ...dependencies, '--cwd', installDir, '--optional']
  }

  if (pm === 'pnpm') {
    return ['add', ...dependencies, '--dir', installDir, '--save-optional']
  }

  if (pm === 'bun') {
    return ['add', ...dependencies, '--cwd', installDir, '--optional']
  }

  return ['install', ...dependencies, '--prefix', installDir, '--save-optional']
}

function buildBuildInstallArgs(
  pm: string,
  dependencies: string[],
  dependencyMap: Record<string, string>
) {
  const depsWithVersions = dependencies.map(
    (dep) => `${dep}@${dependencyMap[dep]}`
  )

  if (pm === 'yarn') {
    return ['add', ...depsWithVersions]
  }

  if (pm === 'pnpm') {
    return ['add', '--save', ...depsWithVersions]
  }

  if (pm === 'bun') {
    return ['add', ...depsWithVersions]
  }

  return ['install', '--save', ...depsWithVersions]
}

function resolveMissingBuildDeps(developRoot: string): BuildDepsPlan {
  const dependencyMap = loadBuildDependencies(developRoot)
  const candidates = Object.keys(dependencyMap)
  const missing = candidates.filter(
    (dep) => !canResolve(dep, [developRoot, process.cwd()])
  )

  return {dependencies: missing, dependencyMap}
}

function resolveMissingOptionalDeps(
  developRoot: string,
  projectPath: string
): OptionalDepsPlan {
  const plan = detectOptionalDependencies(projectPath)
  const missing = plan.dependencies.filter(
    (dep) => !canResolve(dep, [developRoot, projectPath, process.cwd()])
  )

  return {integrations: plan.integrations, dependencies: missing}
}

async function installBuildDependencies(
  developRoot: string,
  plan: BuildDepsPlan
) {
  if (plan.dependencies.length === 0) return

  const pm = detectPackageManagerFromEnv()
  const installMessage = messages.installingBuildDependencies(plan.dependencies)
  const progressEnabled = shouldShowProgress()
  const progress = startProgressBar(installMessage, {
    enabled: progressEnabled,
    persistLabel: true
  })

  if (!progressEnabled) {
    console.log(installMessage)
  }

  try {
    const args = buildBuildInstallArgs(
      pm,
      plan.dependencies,
      plan.dependencyMap
    )
    const stdio =
      process.env.EXTENSION_ENV === 'development' ? 'inherit' : 'ignore'
    const result = await runInstall(pm, args, {
      cwd: developRoot,
      stdio
    })

    if (result.code !== 0) {
      throw new Error(
        messages.installingDependenciesFailed(pm, args, result.code)
      )
    }
  } finally {
    progress.stop()
  }
}

async function installOptionalDependencies(
  developRoot: string,
  plan: OptionalDepsPlan
) {
  if (plan.dependencies.length === 0) return

  const pm = detectPackageManagerFromEnv()
  const installMessages = messages.installingProjectIntegrations(
    plan.integrations
  )
  installMessages.forEach((message) => console.log(message))

  const args = buildOptionalInstallArgs(pm, plan.dependencies, developRoot)
  const stdio =
    process.env.EXTENSION_ENV === 'development' ? 'inherit' : 'ignore'
  const result = await runInstall(pm, args, {
    cwd: developRoot,
    stdio
  })

  if (result.code !== 0) {
    throw new Error(
      messages.installingDependenciesFailed(pm, args, result.code)
    )
  }
}

export async function installInternalDependencies(projectPath: string) {
  if (
    process.env.EXTENSION_ENV === 'test' ||
    process.env.EXTENSION_SKIP_INTERNAL_INSTALL === 'true'
  )
    return

  const developRoot = resolveDevelopRoot(projectPath)
  if (!developRoot) return

  const buildPlan = resolveMissingBuildDeps(developRoot)
  if (buildPlan.dependencies.length === 0) {
    console.log(messages.installingBuildDependencies(buildPlan.dependencies))
  } else {
    await installBuildDependencies(developRoot, buildPlan)
  }

  const optionalPlan = resolveMissingOptionalDeps(developRoot, projectPath)
  if (optionalPlan.dependencies.length === 0) {
    if (optionalPlan.integrations.length > 0) {
      messages
        .installingProjectIntegrations(optionalPlan.integrations)
        .forEach((message) => console.log(message))
    }
  } else {
    await installOptionalDependencies(developRoot, optionalPlan)
  }
}

export const __testing__ = {
  resolveDevelopRoot,
  resolveMissingBuildDeps,
  resolveMissingOptionalDeps,
  detectOptionalDependencies
}
