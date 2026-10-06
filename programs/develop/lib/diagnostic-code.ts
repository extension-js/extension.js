// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {CODES, type ErrorCode} from './messaging'

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
const NAMED_CODES: Record<string, ErrorCode> = {
  WARInvalidMatchPattern: CODES.E_WAR_INVALID,
  WARStringEntryInMv3: CODES.E_WAR_INVALID,
  LocalesLayoutWarning: CODES.E_LOCALES_LAYOUT,
  LocalesFolderWithoutMessages: CODES.E_LOCALES_LAYOUT,
  PerfBudgetWarning: CODES.E_PERF_BUDGET,
  EnvNoMatchingFile: CODES.E_ENV_NO_MATCH,
  JSONMissingFile: CODES.E_ENTRY_NOT_FOUND,
  LocalesPluginMissingFile: CODES.E_ENTRY_NOT_FOUND,
  HtmlEntrypointMissing: CODES.E_ENTRY_NOT_FOUND,
  ScriptsMissingFile: CODES.E_ENTRY_NOT_FOUND,
  HtmlPublicAssetMissing: CODES.E_ASSET_MISSING,
  WARRelativeAssetMissing: CODES.E_ASSET_MISSING,
  MissingCssAssetWarning: CODES.E_ASSET_MISSING,
  RuntimeLoadedFileCompileFailed: CODES.E_SCRIPT_DEP_MISSING,
  UnresolvedBareRequireWarning: CODES.E_SCRIPT_DEP_MISSING,
  RemoteResourceBlocked: CODES.E_REMOTE_RESOURCE_BLOCKED,
  ReservedScriptsFolder: CODES.E_RESERVED_FOLDER,
  CssPreprocessorMissing: CODES.E_CSS_PREPROCESSOR_MISSING,
  CssDeadRef: CODES.E_CSS_DEAD_REF,
  CssParseWarning: CODES.E_CSS_PARSE,
  BackgroundRequired: CODES.E_BACKGROUND_REQUIRED,
  ContentScriptSyntax: CODES.E_CONTENT_SCRIPT_SYNTAX
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
    /^\s*[×]?\s*Module not found:/.test(text(err.message))
  )
}

function isSyntaxFailure(err: IssueLike): boolean {
  return (
    err.name === 'ModuleBuildError' && /syntax/i.test(text(err.error?.name))
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

  return undefined
}
