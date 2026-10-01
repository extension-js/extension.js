export declare const EXTENSION_ENV_TYPES_PACKAGE: 'extension'

export declare function renderDefineDeclarations(
  defineTypes?: Readonly<Record<string, string>>
): string

export declare function renderExtensionEnvTypes(
  typePath?: string,
  defineTypes?: Readonly<Record<string, string>>
): string
