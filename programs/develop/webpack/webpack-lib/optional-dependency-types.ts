// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

export type OptionalDependencyVerificationRule =
  | {type: 'install-root'; packageId: string}
  | {
      type: 'module-context-resolve' | 'module-context-load'
      fromPackage: string
      packageId: string
    }

export type OptionalDependencyContract = {
  id: string
  integration: string
  installPackages: string[]
  verificationRules: OptionalDependencyVerificationRule[]
}
