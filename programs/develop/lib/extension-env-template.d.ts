export declare const EXTENSION_ENV_TYPES_PACKAGE: 'extension'

export interface WildcardModuleDeclaration {
  readonly pattern: string
  readonly type: string
}

export declare const EXTENSION_ENV_WILDCARD_MODULES: readonly WildcardModuleDeclaration[]

export interface RenderExtensionEnvTypesOptions {
  readonly inlineAssetTypes?: boolean
  readonly ownChromeTypes?: boolean
}

export declare function projectBringsOwnChromeTypes(projectDir: string): boolean

export declare function renderExtensionEnvTypes(
  typePath?: string,
  defineTypes?: Readonly<Record<string, string>>,
  options?: RenderExtensionEnvTypesOptions
): string
