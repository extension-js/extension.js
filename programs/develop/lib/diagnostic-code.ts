// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {CODES, prefix as channelPrefix, type ErrorCode} from './messaging'

export type WarningCode = Extract<ErrorCode, `W_${string}`>

export interface DiagnosticContext {
  contentScripts?: ReadonlySet<string>
}

interface IssueLike {
  code?: unknown
  name?: unknown
  message?: unknown
  details?: unknown
  error?: {name?: unknown} | null
  module?: {resource?: unknown} | null
}

// Every plugin diagnostic names itself, and this table is the one place that
// name meets the code a consumer reads.
export const NAMED_CODES: Record<string, ErrorCode> = {
  WARInvalidMatchPattern: CODES.E_WAR_INVALID,
  WARStringEntryInMv3: CODES.E_WAR_INVALID,
  WARPatternLeavesRoot: CODES.W_WAR_INVALID,
  ThemeArrayInvalid: CODES.E_THEME_INVALID,
  LocalesLayoutWarning: CODES.E_LOCALES_LAYOUT,
  LocalesFolderWithoutMessages: CODES.E_LOCALES_LAYOUT,
  LocalesValidationError: CODES.E_LOCALES_LAYOUT,
  PerfBudgetWarning: CODES.W_PERF_BUDGET,
  PerfBudgetError: CODES.E_PERF_BUDGET,
  EnvNoMatchingFile: CODES.W_ENV_NO_MATCH,
  JSONMissingFile: CODES.E_ENTRY_NOT_FOUND,
  LocalesPluginMissingFile: CODES.E_ENTRY_NOT_FOUND,
  HtmlEntrypointMissing: CODES.E_ENTRY_NOT_FOUND,
  ScriptsMissingFile: CODES.E_ENTRY_NOT_FOUND,
  ManifestPageMissing: CODES.E_ENTRY_NOT_FOUND,
  ManifestFilesNotEmitted: CODES.E_ENTRY_NOT_FOUND,
  JSONPathIsFolder: CODES.E_ENTRY_NOT_FOUND,
  ManifestNamedFileNotShipped: CODES.E_ENTRY_NOT_FOUND,
  IconsMissingFile: CODES.E_ASSET_MISSING,
  HtmlAssetMissing: CODES.E_ASSET_MISSING,
  HtmlPublicAssetMissing: CODES.E_ASSET_MISSING,
  WARRelativeAssetMissing: CODES.E_ASSET_MISSING,
  PublicFolderOffRef: CODES.E_ASSET_MISSING,
  RootAbsoluteRefCompiledSource: CODES.E_ASSET_MISSING,
  RuntimeLoadedFileCompileFailed: CODES.E_SCRIPT_DEP_MISSING,
  RuntimeSetSurfaceFileMissing: CODES.E_ASSET_MISSING,
  CodeNamedFileNotShipped: CODES.E_SCRIPT_DEP_MISSING,
  RuntimeFetchedFileMissing: CODES.E_SCRIPT_DEP_MISSING,
  ImportScriptsDependencyMissing: CODES.E_SCRIPT_DEP_MISSING,
  InjectedScriptFilesMissing: CODES.E_SCRIPT_DEP_MISSING,
  UnresolvedBareRequireWarning: CODES.E_SCRIPT_DEP_MISSING,
  ImportScriptsCompiledSource: CODES.E_SCRIPT_DEP_MISSING,
  InjectedScriptCompiledSource: CODES.E_SCRIPT_DEP_MISSING,
  RuntimeStaticImportFileMissing: CODES.E_SCRIPT_DEP_MISSING,
  UnbundledScriptImport: CODES.E_SCRIPT_DEP_MISSING,
  RuntimeGetURLFileMissing: CODES.E_SCRIPT_DEP_MISSING,
  RuntimeGetURLCompiledSource: CODES.E_SCRIPT_DEP_MISSING,
  RuntimeAssetFolderNotShipped: CODES.E_SCRIPT_DEP_MISSING,
  MovedPageRelativeUrl: CODES.E_SCRIPT_DEP_MISSING,
  WebkitDroppedPageOpened: CODES.E_SCRIPT_DEP_MISSING,
  NodeBuiltinNotAvailable: CODES.E_MODULE_NOT_FOUND,
  RemoteResourceBlocked: CODES.W_REMOTE_RESOURCE_BLOCKED,
  ReservedScriptsFolder: CODES.E_RESERVED_FOLDER,
  ScriptsFolderEntryOnlyImported: CODES.W_RESERVED_FOLDER,
  CssPreprocessorMissing: CODES.E_CSS_PREPROCESSOR_MISSING,
  CssDeadRef: CODES.E_CSS_DEAD_REF,
  CssWithheldRef: CODES.E_CSS_DEAD_REF,
  CssParseWarning: CODES.E_CSS_PARSE,
  CssMinifierDroppedRules: CODES.E_CSS_PARSE,
  BackgroundRequired: CODES.E_BACKGROUND_REQUIRED,
  ContentScriptSyntax: CODES.E_CONTENT_SCRIPT_SYNTAX,
  ManifestNotFoundError: CODES.E_MANIFEST_NOT_FOUND,
  ManifestFatalShapeWarning: CODES.W_MANIFEST_INVALID,
  MainWorldScriptCompileFailed: CODES.E_COMPILE,
  ContentScriptDevServerRuntimeWarning: CODES.W_INTERNAL,
  ScriptsPathCheckFailed: CODES.E_INTERNAL,
  CssUrlRewriteWarning: CODES.W_INTERNAL,
  SpecialFoldersRemoval: CODES.E_RESTART_REQUIRED,
  HtmlEntrypointChanged: CODES.E_RESTART_REQUIRED,
  EnvFileChange: CODES.W_RESTART_REQUIRED,
  ProjectConfigChange: CODES.W_RESTART_REQUIRED,
  SpecialFoldersChange: CODES.W_RESTART_REQUIRED,
  MainWorldRegistrationChange: CODES.W_RESTART_REQUIRED,
  PublicFolderAppearedWarning: CODES.W_RESTART_REQUIRED,
  CssSetupWarning: CODES.W_RESTART_REQUIRED,
  JSONInvalidSyntax: CODES.E_JSON_INVALID,
  DNRInvalidRuleset: CODES.E_JSON_INVALID,
  DNRInvalidRule: CODES.E_JSON_INVALID,
  ManagedSchemaInvalid: CODES.E_JSON_INVALID,
  EnvValueBreaksJsonAsset: CODES.E_JSON_INVALID,
  DNRRuleShapeIssue: CODES.W_JSON_INVALID,
  DNRDuplicateRuleId: CODES.W_JSON_INVALID,
  DNRRegexChromeCannotCompile: CODES.W_JSON_INVALID,
  PublicOutputCollision: CODES.E_PROJECT_LAYOUT,
  IncludeFilesError: CODES.E_PROJECT_LAYOUT,
  SpecialFolderUnreadable: CODES.E_FOLDER_UNREADABLE,
  ManifestInPublicFolder: CODES.E_MANIFEST_IN_PUBLIC,
  CompanionLinkNotAStoreLink: CODES.E_COMPANION_EXTENSION_PATH,
  CompanionEntryLooksLikeStoreId: CODES.E_COMPANION_EXTENSION_PATH,
  CompanionEntryNotLinkOrFolder: CODES.E_COMPANION_EXTENSION_PATH,
  CompanionStoreDownloadEmpty: CODES.E_PROJECT_DOWNLOAD_EMPTY,
  ManifestPersistFailed: CODES.E_OUTPUT_NOT_WRITABLE,
  PublicFolderShadowedWarning: CODES.W_PROJECT_LAYOUT,
  PublicLayoutWarning: CODES.W_PROJECT_LAYOUT,
  ExcludeFilesWarning: CODES.W_PROJECT_LAYOUT,
  ScriptsFolderFilesLeftOutWarning: CODES.W_PROJECT_LAYOUT,
  PublicEnvFilesWarning: CODES.W_PROJECT_LAYOUT,
  PublicLinkedFilesWarning: CODES.W_PROJECT_LAYOUT,
  PublicFileShadowedWarning: CODES.W_PROJECT_LAYOUT,
  PublicFolderCaseWarning: CODES.W_PROJECT_LAYOUT,
  NamespaceImportReadAsValue: CODES.E_ASSET_IMPORT_SHAPE,
  ManifestV2OnChromiumWarning: CODES.W_MANIFEST_COMPAT,
  ManifestLegacyWarning: CODES.W_MANIFEST_COMPAT,
  ManifestHostPermissionWarning: CODES.W_MANIFEST_COMPAT,
  GeckoAddonIdWarning: CODES.W_MANIFEST_COMPAT,
  WebAssemblyPolicyWarning: CODES.W_MANIFEST_COMPAT,
  ManifestDescriptionWarning: CODES.W_STORE_READINESS,
  AmoDataCollectionWarning: CODES.W_STORE_READINESS,
  RemoteWebAssemblyWarning: CODES.W_STORE_READINESS,
  UndeclaredPermissionWarning: CODES.W_PERMISSION_MISMATCH,
  ContentScriptHostAccessWarning: CODES.W_PERMISSION_MISMATCH,
  DevInjectedPermissionWarning: CODES.W_PERMISSION_MISMATCH,
  DevInjectedHostWarning: CODES.W_PERMISSION_MISMATCH,
  DevPromotedOptionalPermissionWarning: CODES.W_PERMISSION_MISMATCH,
  DevPromotedOptionalHostWarning: CODES.W_PERMISSION_MISMATCH,
  GeckoUnsupportedApiWarning: CODES.W_API_UNSUPPORTED,
  GeckoCallbackFormWarning: CODES.W_API_UNSUPPORTED,
  SafariUnsupportedApiWarning: CODES.W_API_UNSUPPORTED,
  BrowserGlobalWithoutPolyfillWarning: CODES.W_API_UNSUPPORTED,
  UnreachableWebAccessibleResourceWarning: CODES.W_WAR_EXPOSURE,
  PageNamedNotExposedWarning: CODES.W_WAR_EXPOSURE,
  InjectedScriptResourceExposedWarning: CODES.W_WAR_EXPOSURE,
  CssUnplacedImport: CODES.W_CSS_NOT_APPLIED,
  InjectedSheetImportKept: CODES.W_CSS_NOT_APPLIED,
  PublicInjectedSheetImportIgnored: CODES.W_CSS_NOT_APPLIED,
  PublicInjectedSheetPageRelativeTarget: CODES.W_CSS_NOT_APPLIED,
  EnvPublicSecretName: CODES.W_ENV_SECRET_PUBLIC,
  MissingBuildConstantWarning: CODES.W_BUILD_CONSTANT_UNDEFINED,
  EnvPrivatePlaceholder: CODES.W_BUILD_CONSTANT_UNDEFINED,
  EnvReservedName: CODES.W_ENV_NAME_RESERVED,
  EnvDefinedNameWritten: CODES.W_ENV_DEFINE_WRITTEN,
  EnvPlaceholderNotUtf8: CODES.W_ENV_ASSET_NOT_UTF8,
  UnknownRegistrationWorld: CODES.W_SCRIPT_WORLD_UNKNOWN
}

// The bundler wraps what a loader threw or emitted under one of these names
// and keeps the original on `error` or at the head of the stack in `details`.
const WRAPPER_NAMES = new Set([
  'Error',
  'ModuleBuildError',
  'ModuleError',
  'ModuleWarning',
  'ModuleParseError',
  'ModuleParseWarning',
  'ModuleNotFoundError'
])

const STYLESHEET = /\.(?:css|scss|sass|less|styl|pcss)(?:\?.*)?$/i

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function isKnownDiagnosticName(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(NAMED_CODES, name)
}

export function diagnosticName(issue: unknown): string | undefined {
  const err = (issue ?? {}) as IssueLike
  const own = text(err.name)
  if (own && !WRAPPER_NAMES.has(own)) return own

  const inner = text(err.error?.name)
  if (inner && !WRAPPER_NAMES.has(inner)) return inner

  const header = /^([A-Za-z]\w*): /.exec(text(err.details))?.[1]
  if (header && !WRAPPER_NAMES.has(header)) return header

  return undefined
}

function isModuleNotFound(err: IssueLike): boolean {
  return (
    err.name === 'ModuleNotFoundError' ||
    /^\s*[×⚠]?\s*Module not found:/.test(text(err.message))
  )
}

function isSyntaxFailure(err: IssueLike): boolean {
  return (
    err.name === 'ModuleBuildError' && /syntax/i.test(text(err.error?.name))
  )
}

// The late @import loader warns through a plain Error, so the loader the
// bundler names in its header is what tells this warning from any other.
function isLateCssImport(err: IssueLike): boolean {
  return (
    err.name === 'ModuleWarning' &&
    /^[^\n]*\(from [^\n]*late-css-import-loader[^\n]*\):/.test(
      text(err.message)
    )
  )
}

function resource(err: IssueLike): string {
  return text(err.module?.resource)
}

export function diagnosticCode(
  issue: unknown,
  context: DiagnosticContext = {}
): ErrorCode | undefined {
  const err = (issue ?? {}) as IssueLike
  const declared = text(err.code)

  if (declared && Object.prototype.hasOwnProperty.call(CODES, declared)) {
    return declared as ErrorCode
  }

  const named = diagnosticName(issue)
  if (named && NAMED_CODES[named]) return NAMED_CODES[named]

  if (isModuleNotFound(err)) return CODES.E_MODULE_NOT_FOUND

  if (isSyntaxFailure(err) && context.contentScripts?.has(resource(err))) {
    return CODES.E_CONTENT_SCRIPT_SYNTAX
  }

  if (err.name === 'ModuleParseError' && STYLESHEET.test(resource(err))) {
    return CODES.E_CSS_PARSE
  }

  // The bundler's own parser fails the module on this rule, which is the
  // same finding the loader reports once it has blanked the rule out.
  if (isLateCssImport(err)) return CODES.E_CSS_PARSE

  return undefined
}

function hasCode(name: string): name is ErrorCode {
  return Object.prototype.hasOwnProperty.call(CODES, name)
}

// A class with errors and warnings spells both the same after the prefix.
function twin(code: ErrorCode, prefix: 'E_' | 'W_'): ErrorCode | undefined {
  const name = prefix + code.slice(2)

  return hasCode(name) ? name : undefined
}

export function warningCodeOf(code: ErrorCode): WarningCode | undefined {
  const name = code.startsWith('W_') ? code : twin(code, 'W_')

  return name as WarningCode | undefined
}

// A watch session meets the same gap on every rebuild, and says it once.
const toldGaps = new Set<string>()

// The one place a class meets its severity: a warning reads W_ and an
// error reads E_, and no other pairing leaves this function.
export function codeForSeverity(
  code: ErrorCode,
  severity: 'error' | 'warning'
): ErrorCode | undefined {
  const prefix = severity === 'warning' ? 'W_' : 'E_'
  const name = code.startsWith(prefix) ? code : twin(code, prefix)
  if (name) return name

  const gap = `${code} has no ${prefix} name in CODES, so it cannot be reported as ${severity === 'warning' ? 'a warning' : 'an error'}`

  // A spec fails on the gap. A real run drops the code and carries on, and
  // tells its authors, since one stray child warning must not end a session.
  if (process.env.VITEST) throw new Error(gap)

  if (process.env.EXTENSION_AUTHOR_MODE === 'true' && !toldGaps.has(gap)) {
    toldGaps.add(gap)
    console.error(`${channelPrefix('warn')} ${gap}.`)
  }

  return undefined
}
