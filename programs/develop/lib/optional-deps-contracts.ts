import type {
  OptionalDependencyContract,
  OptionalDependencyVerificationRule
} from './optional-dependency-types'

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
    installPackages: ['typescript@5.9.3'],
    verificationRules: installRootRules(['typescript'])
  }),
  'react-refresh': defineContract({
    id: 'react-refresh',
    integration: 'React',
    installPackages: [
      'react-refresh@0.18.0',
      '@rspack/plugin-react-refresh@1.6.0'
    ],
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
      '@prefresh/core@1.5.9',
      '@prefresh/utils@1.2.1',
      // 1.1.5 is required for rspack 2.x: 1.1.4 only checks
      // `runtimeModule.constructorName`, which is `undefined` in rspack 2.x.
      // Without the v1.1.5 fallback to `runtimeModule.constructor?.name`,
      // the HMR runtime intercept is never appended and `$RefreshReg$` is
      // undefined when the user's bundle evaluates.
      '@rspack/plugin-preact-refresh@1.1.5',
      'preact@10.27.2'
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
    installPackages: [
      'vue-loader@17.4.2',
      '@vue/compiler-sfc@3.5.26',
      'vue@3.5.26'
    ],
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
    installPackages: ['typescript@5.9.3', 'svelte-loader@3.2.4'],
    verificationRules: installRootRules(['typescript', 'svelte-loader'])
  }),
  less: defineContract({
    id: 'less',
    integration: 'LESS',
    installPackages: ['less@4.5.1', 'less-loader@12.3.0'],
    verificationRules: installRootRules(['less', 'less-loader'])
  }),
  postcss: defineContract({
    id: 'postcss',
    integration: 'PostCSS',
    installPackages: ['postcss@8.5.6', 'postcss-loader@8.2.0'],
    verificationRules: installRootRules(['postcss', 'postcss-loader'])
  }),
  sass: defineContract({
    id: 'sass',
    integration: 'SASS',
    installPackages: [
      'postcss-loader@8.2.0',
      'postcss-scss@4.0.9',
      'postcss-preset-env@11.1.1',
      'sass-loader@16.0.6'
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

export function getContractsSignature(): string {
  const allSpecs = Object.values(OPTIONAL_DEPENDENCY_CONTRACTS)
    .flatMap((c) => c.installPackages)
    .sort()
  return allSpecs.join('::')
}

export {
  OPTIONAL_DEPENDENCY_CONTRACTS,
  type OptionalDependencyContract,
  type OptionalDependencyVerificationRule
}
