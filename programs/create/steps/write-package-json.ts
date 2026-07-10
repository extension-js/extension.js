//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import * as fs from 'fs/promises'
import * as messages from '../lib/messages'
import {getPackageManagerSpecFromEnv} from '../lib/package-manager'

export async function resolveExtensionBinary(): Promise<string> {
  const developRoot = process.env.EXTENSION_CREATE_DEVELOP_ROOT
  if (developRoot) {
    // In repo author mode, route scaffolded scripts to the local CLI build so
    // `npm run dev` exercises current source changes instead of npm-published bits.
    const localCliPath = path.resolve(
      developRoot,
      '..',
      'cli',
      'dist',
      'cli.cjs'
    )
    try {
      await fs.access(localCliPath)
      return `node "${localCliPath}"`
    } catch {
      // Fall through to installed package binary path.
    }
  }

  if (process.env.EXTENSION_ENV === 'development') {
    return 'node node_modules/extension'
  }

  return 'extension'
}

function extensionJsPackageJsonScripts(extensionBinary: string) {
  return {
    dev: `${extensionBinary} dev`,
    start: `${extensionBinary} start`,
    build: `${extensionBinary} build`,
    preview: `${extensionBinary} preview`,
    // Convenience scripts to highlight multi-browser builds
    'build:chrome': `${extensionBinary} build --browser chrome`,
    'build:firefox': `${extensionBinary} build --browser firefox`,
    'build:edge': `${extensionBinary} build --browser edge`
  }
}

export function getTemplateAwareScripts(
  template: string,
  extensionBinary: string
): Record<string, string> {
  // Monorepo templates keep manifest under packages/extension/src.
  // Root scripts must target that package path explicitly.
  if (String(template).toLowerCase().includes('monorepo')) {
    const target = 'packages/extension'
    return {
      dev: `${extensionBinary} dev ${target}`,
      start: `${extensionBinary} start ${target}`,
      build: `${extensionBinary} build ${target}`,
      preview: `${extensionBinary} preview ${target}`,
      'build:chrome': `${extensionBinary} build ${target} --browser chrome`,
      'build:firefox': `${extensionBinary} build ${target} --browser firefox`,
      'build:edge': `${extensionBinary} build ${target} --browser edge`
    }
  }

  return extensionJsPackageJsonScripts(extensionBinary)
}

interface OverridePackageJsonOptions {
  /** Defaults to `javascript` when omitted (same as `extensionCreate`). */
  template?: string
  cliVersion?: string
}

// `less` rides in transitively via extension-develop (Less compilation support).
// Its postinstall only installs Playwright inside less.js's own dev monorepo and
// is a no-op when installed as a dependency — so pnpm's "Ignored build scripts"
// warning is pure noise. Suppress it in every scaffold so `pnpm install` is clean.
const BUILD_NOOP_DEPENDENCIES = ['less']

// Native packages that MUST run their install script (download/build platform
// binaries) or the extension breaks at runtime. They arrive via the
// transformers ML stack. pnpm blocks build scripts by default and bun only runs
// them for `trustedDependencies`, so without pre-approval the user has to run a
// manual `approve-builds`/`--trust` middle step. npm/yarn run them by default.
const ML_NATIVE_BUILD_DEPENDENCIES = ['onnxruntime-node', 'sharp', 'protobufjs']
const ML_DEP_TRIGGERS = ['@huggingface/transformers', '@xenova/transformers']

const uniq = (values: Array<string | undefined>): string[] =>
  Array.from(new Set(values.filter(Boolean) as string[]))

export function resolveExtensionDevDependencyVersion(
  cliVersion?: string
): string {
  if (!cliVersion) {
    return 'latest'
  }

  // Prerelease ranges like ^3.8.7-canary... can resolve to stable releases
  // with npm semver range matching; pin prereleases exactly.
  return cliVersion.includes('-') ? cliVersion : `^${cliVersion}`
}

export async function overridePackageJson(
  projectPath: string,
  projectName: string,
  {template = 'javascript', cliVersion}: OverridePackageJsonOptions,
  logger: {log(...args: any[]): void; error(...args: any[]): void}
) {
  const extensionBinary = await resolveExtensionBinary()
  const candidatePath = path.join(projectPath, 'package.json')

  // Web-only remote templates may not include package.json; start from a minimal base
  let packageJson: Record<string, any> = {}

  try {
    const packageJsonContent = await fs.readFile(candidatePath)
    packageJson = JSON.parse(packageJsonContent.toString())
  } catch {
    packageJson = {
      name: path.basename(projectPath),
      private: true,
      scripts: {},
      dependencies: {},
      devDependencies: {}
    }
  }

  packageJson.scripts = packageJson.scripts || {}
  packageJson.dependencies = packageJson.dependencies || {}
  packageJson.devDependencies = {
    ...(packageJson.devDependencies || {}),
    // During development, we want to use the local version of Extension.js
    extension:
      process.env.EXTENSION_ENV === 'development'
        ? '*'
        : resolveExtensionDevDependencyVersion(cliVersion)
  }

  const packageManagerSpec =
    packageJson.packageManager || getPackageManagerSpecFromEnv()

  // Pre-approve dependency build scripts so a single install "just works" with
  // no manual approve-builds step — across pnpm and bun (npm/yarn run scripts by
  // default and ignore these keys). Native ML builds are only approved when the
  // project actually pulls the transformers stack, keeping plain scaffolds clean.
  const declaredDeps = {
    ...(packageJson.dependencies || {}),
    ...(packageJson.devDependencies || {})
  }
  const usesMlNativeDeps = ML_DEP_TRIGGERS.some((dep) => declaredDeps[dep])
  const nativeBuildDeps = usesMlNativeDeps ? ML_NATIVE_BUILD_DEPENDENCIES : []

  const existingPnpm =
    packageJson.pnpm && typeof packageJson.pnpm === 'object'
      ? packageJson.pnpm
      : {}
  const ignoredBuilt = uniq([
    ...(existingPnpm.ignoredBuiltDependencies || []),
    ...BUILD_NOOP_DEPENDENCIES
  ])
  const onlyBuilt = uniq([
    ...(existingPnpm.onlyBuiltDependencies || []),
    ...nativeBuildDeps
  ])
  const trustedDeps = uniq([
    ...(packageJson.trustedDependencies || []),
    ...nativeBuildDeps
  ])

  const packageMetadata = {
    ...packageJson,
    name: path.basename(projectPath),
    private: true,
    ...(packageManagerSpec ? {packageManager: packageManagerSpec} : {}),
    scripts: {
      ...getTemplateAwareScripts(template, extensionBinary),
      ...packageJson.scripts
    },
    dependencies: packageJson.dependencies,
    devDependencies: packageJson.devDependencies,
    pnpm: {
      ...existingPnpm,
      ...(ignoredBuilt.length ? {ignoredBuiltDependencies: ignoredBuilt} : {}),
      ...(onlyBuilt.length ? {onlyBuiltDependencies: onlyBuilt} : {})
    },
    ...(trustedDeps.length ? {trustedDependencies: trustedDeps} : {}),
    author: {
      name: 'Your Name',
      email: 'your@email.com',
      url: 'https://yourwebsite.com'
    }
  }

  try {
    logger.log(messages.writingPackageJsonMetadata())
    await fs.writeFile(
      path.join(projectPath, 'package.json'),
      JSON.stringify(packageMetadata, null, 2) + '\n'
    )
  } catch (error: any) {
    logger.error(messages.writingPackageJsonMetadataError(projectName, error))
    throw error
  }
}
