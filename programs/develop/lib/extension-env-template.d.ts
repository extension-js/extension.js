// Hand written declaration for extension-env-template.js. The runtime module
// stays JS so extension-create can import it past its tsconfig rootDir.
export declare const EXTENSION_ENV_TYPES_PACKAGE: 'extension'

export interface WildcardModuleDeclaration {
  readonly pattern: string
  readonly type: string
}

export declare const EXTENSION_ENV_WILDCARD_MODULES: readonly WildcardModuleDeclaration[]

export declare function renderWildcardModuleDeclarations(
  modules?: readonly WildcardModuleDeclaration[]
): string

export declare function renderExtensionEnvTypes(typePath?: string): string
