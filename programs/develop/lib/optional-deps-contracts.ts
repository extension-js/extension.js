// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import developPackageJson from '../package.json'
import type {
  OptionalDependencyContract,
  OptionalDependencyVerificationRule
} from './optional-dependency-types'

// Every package a contract can suggest installing is already bundled as a hard
// dependency of extension-develop. Treat that package.json as the single source
// of truth for versions so the install hints we print can never drift from what
// actually ships (previously the versions were hand-duplicated here and had
// silently diverged, e.g. hinting less-loader@12 while shipping 13).
const BUNDLED_DEPENDENCY_VERSIONS: Record<string, string> = {
  ...((developPackageJson as {dependencies?: Record<string, string>})
    .dependencies || {})
}

// Build a `name@version` spec pinned to the bundled version. Falls back to the
// bare name if a package somehow isn't bundled, keeping the hint usable rather
// than throwing at import time.
function spec(packageId: string): string {
  const version = BUNDLED_DEPENDENCY_VERSIONS[packageId]
  return version ? `${packageId}@${version}` : packageId
}

function specs(packageIds: string[]): string[] {
  return packageIds.map(spec)
}

function installRootRules(
  packageIds: string[]
): OptionalDependencyVerificationRule[] {
  return packageIds.map((packageId) => ({
    type: 'install-root',
    packageId
  }))
}

function defineContract(
  contract: OptionalDependencyContract
): OptionalDependencyContract {
  return contract
}

// NOTE: there is deliberately no `typescript` contract. Nothing in the build
// needs the package: sources are compiled by swc, and the classic-concat
// loader strips types with swc too. It was only ever satisfiable because
// extension-develop shipped a 24MB copy of its own; verifying it after that
// copy was dropped would hard-fail every project that uses TypeScript without
// declaring it (112 of 902 in the real-world corpus).
const OPTIONAL_DEPENDENCY_CONTRACTS = {
  'react-refresh': defineContract({
    id: 'react-refresh',
    integration: 'React',
    installPackages: specs(['react-refresh', '@rspack/plugin-react-refresh']),
    verificationRules: [
      ...installRootRules(['react-refresh', '@rspack/plugin-react-refresh']),
      {
        type: 'module-context-resolve',
        fromPackage: '@rspack/plugin-react-refresh',
        packageId: 'react-refresh'
      }
    ]
  }),
  'preact-refresh': defineContract({
    id: 'preact-refresh',
    integration: 'Preact',
    // Note on @rspack/plugin-preact-refresh: 2.x is the rspack-2.x-native major:
    // it declares `@rspack/core` ^2.0.0 as a peer and keeps the
    // `runtimeModule.constructor?.name` fallback that 1.1.5 introduced. (Earlier
    // 1.1.4 only checked `runtimeModule.constructorName`, which is `undefined`
    // in rspack 2.x, so the HMR runtime intercept was never appended and
    // `$RefreshReg$` stayed undefined when the user's bundle evaluated.)
    installPackages: specs([
      '@prefresh/core',
      '@prefresh/utils',
      '@rspack/plugin-preact-refresh',
      'preact'
    ]),
    verificationRules: [
      ...installRootRules([
        '@prefresh/core',
        '@prefresh/utils',
        '@rspack/plugin-preact-refresh',
        'preact'
      ]),
      {
        type: 'module-context-resolve',
        fromPackage: '@rspack/plugin-preact-refresh',
        packageId: '@prefresh/core'
      },
      {
        type: 'module-context-resolve',
        fromPackage: '@rspack/plugin-preact-refresh',
        packageId: '@prefresh/utils'
      },
      {
        type: 'module-context-resolve',
        fromPackage: '@rspack/plugin-preact-refresh',
        packageId: 'preact'
      }
    ]
  }),
  vue: defineContract({
    id: 'vue',
    integration: 'Vue',
    installPackages: specs(['vue-loader', '@vue/compiler-sfc', 'vue']),
    verificationRules: [
      ...installRootRules(['vue-loader', '@vue/compiler-sfc', 'vue']),
      {
        type: 'module-context-load',
        fromPackage: 'vue-loader',
        packageId: '@vue/compiler-sfc'
      }
    ]
  }),
  svelte: defineContract({
    id: 'svelte',
    integration: 'Svelte',
    // svelte-loader only. It does not depend on typescript, and requiring it
    // here would hard-fail Svelte projects that never asked for TypeScript.
    installPackages: specs(['svelte-loader']),
    verificationRules: installRootRules(['svelte-loader'])
  }),
  less: defineContract({
    id: 'less',
    integration: 'LESS',
    installPackages: specs(['less', 'less-loader']),
    verificationRules: installRootRules(['less', 'less-loader'])
  }),
  postcss: defineContract({
    id: 'postcss',
    integration: 'PostCSS',
    installPackages: specs(['postcss', 'postcss-loader']),
    verificationRules: installRootRules(['postcss', 'postcss-loader'])
  }),
  sass: defineContract({
    id: 'sass',
    integration: 'SASS',
    installPackages: specs([
      'postcss-loader',
      'postcss-scss',
      'postcss-preset-env',
      'sass-loader'
    ]),
    verificationRules: installRootRules([
      'postcss-loader',
      'postcss-scss',
      'postcss-preset-env',
      'sass-loader'
    ])
  })
} satisfies Record<string, OptionalDependencyContract>

export function getOptionalDependencyContract(contractId: string) {
  const contract =
    OPTIONAL_DEPENDENCY_CONTRACTS[
      contractId as keyof typeof OPTIONAL_DEPENDENCY_CONTRACTS
    ]

  if (!contract) {
    throw new Error(`Unknown optional dependency contract: ${contractId}`)
  }

  return contract
}

export {
  OPTIONAL_DEPENDENCY_CONTRACTS,
  type OptionalDependencyContract,
  type OptionalDependencyVerificationRule
}
