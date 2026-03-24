export type OptionalDependencyVerificationRule =
  | {
      type: 'install-root'
      packageId: string
    }
  | {
      type: 'module-context-resolve'
      fromPackage: string
      packageId: string
    }
  | {
      type: 'module-context-load'
      fromPackage: string
      packageId: string
    }

export type OptionalDependencyContract = {
  id: string
  integration: string
  installPackages: string[]
  verificationRules: OptionalDependencyVerificationRule[]
}
