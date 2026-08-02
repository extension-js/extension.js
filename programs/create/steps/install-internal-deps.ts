//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import {createRequire} from 'node:module'
import * as path from 'node:path'
import {readDenoConfigDependencies} from '../lib/deno-manifest'
import {runInstall} from '../lib/install-runner'
import * as messages from '../lib/messages'
import {isDebug, prefix} from '../lib/messaging'
import {detectPackageManagerFromEnv} from '../lib/package-manager'

const requireFromCreate = createRequire(import.meta.url)

type PackageJson = {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

type OptionalDepsPlan = {
  integrations: string[]
  dependencies: string[]
  dependenciesByIntegration: Record<string, string[]>
}

function resolveDevelopRoot(projectPath: string): string | null {
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
  } catch {
    // ignore local resolution errors and fall back to the CLI/runtime install
  }

  const override = process.env.EXTENSION_CREATE_DEVELOP_ROOT
  if (override) return override

  try {
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

function readPackageJson(
  projectPath: string,
  logger: {log(...args: unknown[]): void; error(...args: unknown[]): void}
): PackageJson {
  let pkg: PackageJson = {}
  const packageJsonPath = path.join(projectPath, 'package.json')
  try {
    const raw = fs.readFileSync(packageJsonPath, 'utf8')
    pkg = JSON.parse(raw)
  } catch (error) {
    // Deno-created scaffolds carry no package.json at all, which stays quiet.
    // A manifest that exists but cannot be parsed must say so, or the run
    // silently detects zero integrations and installs nothing.
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      logger.log(messages.malformedPackageJson(packageJsonPath, error))
    }
  }

  // Deno projects declare npm dependencies in deno.json(c) `imports`;
  // fold them in so integration detection sees them.
  const denoDependencies = readDenoConfigDependencies(projectPath)
  if (Object.keys(denoDependencies).length > 0) {
    pkg = {
      ...pkg,
      dependencies: {...denoDependencies, ...(pkg.dependencies || {})}
    }
  }

  return pkg
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

function detectOptionalDependencies(
  projectPath: string,
  logger: {log(...args: unknown[]): void; error(...args: unknown[]): void}
): OptionalDepsPlan {
  const pkg = readPackageJson(projectPath, logger)

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

  const integrations: string[] = []
  const dependenciesByIntegration: Record<string, string[]> = {}
  const deps = new Set<string>()

  const addIntegration = (name: string, depsForIntegration: string[]) => {
    if (!integrations.includes(name)) {
      integrations.push(name)
    }
    if (!dependenciesByIntegration[name]) {
      dependenciesByIntegration[name] = []
    }
    for (const dep of depsForIntegration) {
      if (!dependenciesByIntegration[name].includes(dep)) {
        dependenciesByIntegration[name].push(dep)
      }
      deps.add(dep)
    }
  }

  if (usesTypeScript) {
    addIntegration('TypeScript', ['typescript'])
  }

  if (usesReact) {
    addIntegration('React', ['react-refresh', '@rspack/plugin-react-refresh'])
  }

  if (usesPreact) {
    addIntegration('Preact', [
      '@prefresh/core',
      '@prefresh/utils',
      '@rspack/plugin-preact-refresh',
      'preact'
    ])
  }

  if (usesVue) {
    addIntegration('Vue', ['vue-loader', '@vue/compiler-sfc'])
  }

  if (usesSvelte) {
    addIntegration('Svelte', ['svelte-loader', 'typescript'])
  }

  if (usesSass) {
    addIntegration('Sass', [
      'sass-loader',
      'postcss-loader',
      'postcss-scss',
      'postcss-preset-env'
    ])
  }

  if (usesLess) {
    addIntegration('Less', ['less', 'less-loader'])
  }

  if (usesPostCss && !usesSass && !usesLess) {
    addIntegration('PostCSS', ['postcss', 'postcss-loader'])
  } else if (usesPostCss) {
    addIntegration('PostCSS', [])
  }

  return {
    integrations,
    dependencies: Array.from(deps),
    dependenciesByIntegration
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
    // Same convention as the project-deps installer: pnpm runs silent.
    return [
      'add',
      ...dependencies,
      '--dir',
      installDir,
      '--save-optional',
      '--silent'
    ]
  }

  if (pm === 'bun') {
    return ['add', ...dependencies, '--cwd', installDir, '--optional']
  }

  // npm already runs with cwd=installDir; avoid --prefix (Windows save-flag
  // regressions) and use --legacy-peer-deps (peer mismatches are hard failures).
  return ['install', ...dependencies, '--save-optional', '--legacy-peer-deps']
}

function resolveMissingOptionalDeps(
  developRoot: string,
  projectPath: string,
  logger: {log(...args: unknown[]): void; error(...args: unknown[]): void}
): OptionalDepsPlan {
  const plan = detectOptionalDependencies(projectPath, logger)
  const dependenciesByIntegration: Record<string, string[]> = {}
  const integrations: string[] = []
  const missing = new Set<string>()

  for (const integration of plan.integrations) {
    const depsForIntegration = plan.dependenciesByIntegration[integration] || []
    const missingForIntegration = depsForIntegration.filter(
      (dep) => !canResolve(dep, [developRoot, projectPath, process.cwd()])
    )

    if (missingForIntegration.length === 0) {
      continue
    }

    integrations.push(integration)
    dependenciesByIntegration[integration] = missingForIntegration
    for (const dep of missingForIntegration) missing.add(dep)
  }

  return {
    integrations,
    dependencies: Array.from(missing),
    dependenciesByIntegration
  }
}

async function installOptionalDependencies(
  developRoot: string,
  projectPath: string,
  plan: OptionalDepsPlan,
  logger: {log(...args: unknown[]): void; error(...args: unknown[]): void}
) {
  if (plan.dependencies.length === 0) return

  const pm = detectPackageManagerFromEnv()
  const stdio =
    process.env.EXTENSION_ENV === 'development' ? 'inherit' : 'ignore'
  if (isDebug()) {
    logger.log(messages.foundSpecializedDependencies(plan.integrations.length))
  }

  // Match on the rendered prefix, not on the bare glyph: the glyph carries
  // color escapes whenever the stream is a TTY, so a literal never matches.
  const infoPrefix = prefix('info')

  for (const [index, integration] of plan.integrations.entries()) {
    const missingDeps = plan.dependenciesByIntegration[integration] || []

    const baseMessage = messages.installingProjectIntegrations([integration])
    const installMessage = baseMessage.replace(
      infoPrefix,
      `${infoPrefix} [${index + 1}/${plan.integrations.length}]`
    )
    logger.log(installMessage)

    if (missingDeps.length === 0) {
      continue
    }

    const args = buildOptionalInstallArgs(pm, missingDeps, developRoot)
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
}

export async function installInternalDependencies(
  projectPath: string,
  logger: {log(...args: unknown[]): void; error(...args: unknown[]): void}
) {
  if (
    process.env.EXTENSION_ENV === 'test' ||
    process.env.EXTENSION_SKIP_INTERNAL_INSTALL === 'true'
  )
    return

  const developRoot = resolveDevelopRoot(projectPath)
  if (!developRoot) return

  const optionalPlan = resolveMissingOptionalDeps(
    developRoot,
    projectPath,
    logger
  )
  if (optionalPlan.dependencies.length > 0) {
    await installOptionalDependencies(
      developRoot,
      projectPath,
      optionalPlan,
      logger
    )
  }
}
