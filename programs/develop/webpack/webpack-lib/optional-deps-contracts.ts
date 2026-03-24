import type {
  OptionalDependencyContract,
  OptionalDependencyVerificationRule
} from '../optional-deps-lib/contract-types'

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

const OPTIONAL_DEPENDENCY_CONTRACTS = {
  typescript: defineContract({
    id: 'typescript',
    integration: 'TypeScript',
    installPackages: ['typescript'],
    verificationRules: installRootRules(['typescript'])
  }),
  'react-refresh': defineContract({
    id: 'react-refresh',
    integration: 'React',
    installPackages: ['react-refresh', '@rspack/plugin-react-refresh'],
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
    installPackages: [
      '@prefresh/core',
      '@prefresh/utils',
      '@rspack/plugin-preact-refresh',
      'preact'
    ],
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
    installPackages: ['vue-loader', '@vue/compiler-sfc', 'vue'],
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
    installPackages: ['typescript', 'svelte-loader'],
    verificationRules: installRootRules(['typescript', 'svelte-loader'])
  }),
  less: defineContract({
    id: 'less',
    integration: 'LESS',
    installPackages: ['less', 'less-loader'],
    verificationRules: installRootRules(['less', 'less-loader'])
  }),
  postcss: defineContract({
    id: 'postcss',
    integration: 'PostCSS',
    installPackages: ['postcss', 'postcss-loader'],
    verificationRules: installRootRules(['postcss', 'postcss-loader'])
  }),
  sass: defineContract({
    id: 'sass',
    integration: 'SASS',
    installPackages: [
      'postcss-loader',
      'postcss-scss',
      'postcss-preset-env',
      'sass-loader'
    ],
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
