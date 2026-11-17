import {describe, expect, it} from 'vitest'
import {toDiagnostic} from '../compilation-diagnostics'
import {
  codeForSeverity,
  DEPRECATED_WARNING_NAMES,
  diagnosticCode,
  diagnosticName,
  NAMED_CODES,
  warningCodeOf
} from '../diagnostic-code'
import {CODES, type ErrorCode} from '../messaging'

function named(name: string, message = 'text') {
  return Object.assign(new Error(message), {name})
}

describe('diagnosticCode', () => {
  it.each([
    ['WARInvalidMatchPattern', 'E_WAR_INVALID'],
    ['WARStringEntryInMv3', 'E_WAR_INVALID'],
    ['WARPatternLeavesRoot', 'W_WAR_INVALID'],
    ['LocalesLayoutWarning', 'E_LOCALES_LAYOUT'],
    ['LocalesFolderWithoutMessages', 'E_LOCALES_LAYOUT'],
    ['LocalesValidationError', 'E_LOCALES_LAYOUT'],
    ['PerfBudgetWarning', 'E_PERF_BUDGET'],
    ['EnvNoMatchingFile', 'E_ENV_NO_MATCH'],
    ['JSONMissingFile', 'E_ENTRY_NOT_FOUND'],
    ['LocalesPluginMissingFile', 'E_ENTRY_NOT_FOUND'],
    ['HtmlEntrypointMissing', 'E_ENTRY_NOT_FOUND'],
    ['ScriptsMissingFile', 'E_ENTRY_NOT_FOUND'],
    ['ManifestPageMissing', 'E_ENTRY_NOT_FOUND'],
    ['ManifestFilesNotEmitted', 'E_ENTRY_NOT_FOUND'],
    ['JSONPathIsFolder', 'E_ENTRY_NOT_FOUND'],
    ['IconsMissingFile', 'E_ASSET_MISSING'],
    ['HtmlAssetMissing', 'E_ASSET_MISSING'],
    ['HtmlPublicAssetMissing', 'E_ASSET_MISSING'],
    ['WARRelativeAssetMissing', 'E_ASSET_MISSING'],
    ['MissingCssAssetWarning', 'E_ASSET_MISSING'],
    ['PublicFolderOffRef', 'E_ASSET_MISSING'],
    ['RootAbsoluteRefCompiledSource', 'E_ASSET_MISSING'],
    ['RuntimeLoadedFileCompileFailed', 'E_SCRIPT_DEP_MISSING'],
    ['UnresolvedBareRequireWarning', 'E_SCRIPT_DEP_MISSING'],
    ['ImportScriptsDependencyMissing', 'E_SCRIPT_DEP_MISSING'],
    ['ImportScriptsCompiledSource', 'E_SCRIPT_DEP_MISSING'],
    ['InjectedScriptFilesMissing', 'E_SCRIPT_DEP_MISSING'],
    ['InjectedScriptCompiledSource', 'E_SCRIPT_DEP_MISSING'],
    ['RuntimeFetchedFileMissing', 'E_SCRIPT_DEP_MISSING'],
    ['RuntimeStaticImportFileMissing', 'E_SCRIPT_DEP_MISSING'],
    ['RuntimeSetSurfaceFileMissing', 'E_SCRIPT_DEP_MISSING'],
    ['RuntimeGetURLFileMissing', 'E_SCRIPT_DEP_MISSING'],
    ['RuntimeGetURLCompiledSource', 'E_SCRIPT_DEP_MISSING'],
    ['RuntimeAssetFolderNotShipped', 'E_SCRIPT_DEP_MISSING'],
    ['MovedPageRelativeUrl', 'E_SCRIPT_DEP_MISSING'],
    ['WebkitDroppedPageOpened', 'E_SCRIPT_DEP_MISSING'],
    ['NodeBuiltinNotAvailable', 'E_MODULE_NOT_FOUND'],
    ['RemoteResourceBlocked', 'E_REMOTE_RESOURCE_BLOCKED'],
    ['ReservedScriptsFolder', 'E_RESERVED_FOLDER'],
    ['ScriptsFolderEntryOnlyImported', 'W_RESERVED_FOLDER'],
    ['CssPreprocessorMissing', 'E_CSS_PREPROCESSOR_MISSING'],
    ['CssDeadRef', 'E_CSS_DEAD_REF'],
    ['CssParseWarning', 'E_CSS_PARSE'],
    ['BackgroundRequired', 'E_BACKGROUND_REQUIRED'],
    ['ContentScriptSyntax', 'E_CONTENT_SCRIPT_SYNTAX'],
    ['ManifestNotFoundError', 'E_MANIFEST_NOT_FOUND'],
    ['ManifestFatalShapeWarning', 'W_MANIFEST_INVALID'],
    ['MainWorldScriptCompileFailed', 'E_COMPILE'],
    ['ContentScriptDevServerRuntimeWarning', 'W_INTERNAL'],
    ['SpecialFoldersRemoval', 'E_RESTART_REQUIRED'],
    ['HtmlEntrypointChanged', 'E_RESTART_REQUIRED'],
    ['EnvFileChange', 'W_RESTART_REQUIRED'],
    ['ProjectConfigChange', 'W_RESTART_REQUIRED'],
    ['SpecialFoldersChange', 'W_RESTART_REQUIRED'],
    ['MainWorldRegistrationChange', 'W_RESTART_REQUIRED'],
    ['PublicFolderAppearedWarning', 'W_RESTART_REQUIRED'],
    ['JSONInvalidSyntax', 'E_JSON_INVALID'],
    ['DNRInvalidRuleset', 'E_JSON_INVALID'],
    ['DNRInvalidRule', 'E_JSON_INVALID'],
    ['ManagedSchemaInvalid', 'E_JSON_INVALID'],
    ['EnvValueBreaksJsonAsset', 'E_JSON_INVALID'],
    ['DNRRuleShapeIssue', 'W_JSON_INVALID'],
    ['DNRDuplicateRuleId', 'W_JSON_INVALID'],
    ['DNRRegexChromeCannotCompile', 'W_JSON_INVALID'],
    ['PublicOutputCollision', 'E_PROJECT_LAYOUT'],
    ['IncludeFilesError', 'E_PROJECT_LAYOUT'],
    ['PublicFolderShadowedWarning', 'W_PROJECT_LAYOUT'],
    ['PublicLayoutWarning', 'W_PROJECT_LAYOUT'],
    ['ExcludeFilesWarning', 'W_PROJECT_LAYOUT'],
    ['NamespaceImportReadAsValue', 'E_ASSET_IMPORT_SHAPE'],
    ['ManifestV2OnChromiumWarning', 'W_MANIFEST_COMPAT'],
    ['ManifestLegacyWarning', 'W_MANIFEST_COMPAT'],
    ['ManifestHostPermissionWarning', 'W_MANIFEST_COMPAT'],
    ['ManifestDescriptionWarning', 'W_STORE_READINESS'],
    ['AmoDataCollectionWarning', 'W_STORE_READINESS'],
    ['UndeclaredPermissionWarning', 'W_PERMISSION_MISMATCH'],
    ['ContentScriptHostAccessWarning', 'W_PERMISSION_MISMATCH'],
    ['DevInjectedPermissionWarning', 'W_PERMISSION_MISMATCH'],
    ['DevInjectedHostWarning', 'W_PERMISSION_MISMATCH'],
    ['DevPromotedOptionalPermissionWarning', 'W_PERMISSION_MISMATCH'],
    ['DevPromotedOptionalHostWarning', 'W_PERMISSION_MISMATCH'],
    ['GeckoUnsupportedApiWarning', 'W_API_UNSUPPORTED'],
    ['GeckoCallbackFormWarning', 'W_API_UNSUPPORTED'],
    ['SafariUnsupportedApiWarning', 'W_API_UNSUPPORTED'],
    ['BrowserGlobalWithoutPolyfillWarning', 'W_API_UNSUPPORTED'],
    ['UnreachableWebAccessibleResourceWarning', 'W_WAR_EXPOSURE'],
    ['PageNamedNotExposedWarning', 'W_WAR_EXPOSURE'],
    ['InjectedScriptResourceExposedWarning', 'W_WAR_EXPOSURE'],
    ['CssUnplacedImport', 'W_CSS_NOT_APPLIED'],
    ['InjectedSheetImportKept', 'W_CSS_NOT_APPLIED'],
    ['PublicInjectedSheetImportIgnored', 'W_CSS_NOT_APPLIED'],
    ['PublicInjectedSheetPageRelativeTarget', 'W_CSS_NOT_APPLIED'],
    ['EnvPublicSecretName', 'W_ENV_SECRET_PUBLIC'],
    ['MissingBuildConstantWarning', 'W_BUILD_CONSTANT_UNDEFINED'],
    ['UnknownRegistrationWorld', 'W_SCRIPT_WORLD_UNKNOWN']
  ])('maps a diagnostic named %s to %s', (name, code) => {
    expect(diagnosticCode(named(name))).toBe(code)
  })

  it('lets a declared code win over the name', () => {
    const issue = Object.assign(named('CssDeadRef'), {code: 'E_ZIP_SKIPPED'})
    expect(diagnosticCode(issue)).toBe('E_ZIP_SKIPPED')
  })

  it('ignores a declared code that is not in the table', () => {
    const issue = Object.assign(named('CssDeadRef'), {code: 'ENOENT'})
    expect(diagnosticCode(issue)).toBe('E_CSS_DEAD_REF')
  })

  it('reads the name a loader threw from under the build error', () => {
    const issue = Object.assign(
      named('ModuleBuildError', 'Module build failed'),
      {
        module: {resource: '/proj/scripts/tool.js'},
        error: named('ReservedScriptsFolder', 'scripts/ is reserved')
      }
    )

    expect(diagnosticName(issue)).toBe('ReservedScriptsFolder')
    expect(diagnosticCode(issue)).toBe('E_RESERVED_FOLDER')
  })

  it('reads the name a loader emitted from the head of details', () => {
    const issue = Object.assign(named('ModuleWarning', 'Module Warning'), {
      module: {resource: '/proj/content/styles.css'},
      details:
        'CssParseWarning: The CSS in this file does not parse\n    at pitch'
    })

    expect(diagnosticName(issue)).toBe('CssParseWarning')
    expect(diagnosticCode(issue)).toBe('E_CSS_PARSE')
  })

  it('codes the late @import warning by the loader that reports it', () => {
    const late = Object.assign(
      new Error(
        '  ⚠ Module Warning (from /abs/extension-develop/dist/late-css-import-loader.mjs):\n' +
          '  │ An @import rule comes after other rules, so browsers skip it.\n'
      ),
      {
        name: 'ModuleWarning',
        module: {resource: '/proj/popup/late.css'},
        details: 'Error: An @import rule comes after other rules\n    at run'
      }
    )
    const other = Object.assign(
      new Error(
        '  ⚠ Module Warning (from /abs/some-loader/index.js):\n' +
          '  │ An @import rule comes after other rules, so browsers skip it.\n'
      ),
      {name: 'ModuleWarning', module: {resource: '/proj/popup/late.css'}}
    )

    expect(diagnosticCode(late)).toBe('E_CSS_PARSE')
    expect(diagnosticCode(other)).toBeUndefined()
  })

  it('maps the native module not found error by its message', () => {
    const issue = Object.assign(
      new Error("  × Module not found: Can't resolve './missing' in '/proj'"),
      {module: {resource: '/proj/background.js'}}
    )

    expect(diagnosticCode(issue)).toBe('E_MODULE_NOT_FOUND')
  })

  it('maps the native module not found error by its name', () => {
    expect(diagnosticCode(named('ModuleNotFoundError', 'nope'))).toBe(
      'E_MODULE_NOT_FOUND'
    )
  })

  it('maps a swc syntax failure on a content script', () => {
    const issue = Object.assign(
      named('ModuleBuildError', 'Module build failed'),
      {
        module: {resource: '/proj/content/scripts.js'},
        error: named('Syntax Error', 'Expression expected')
      }
    )
    const contentScripts = new Set(['/proj/content/scripts.js'])

    expect(diagnosticCode(issue, {contentScripts})).toBe(
      'E_CONTENT_SCRIPT_SYNTAX'
    )

    expect(diagnosticCode(issue, {contentScripts: new Set()})).toBeUndefined()
    expect(diagnosticCode(issue)).toBeUndefined()
  })

  it('maps a native parse error on a stylesheet', () => {
    const issue = Object.assign(
      named('ModuleParseError', 'Module parse failed'),
      {
        module: {resource: '/proj/content/styles.css'}
      }
    )

    expect(diagnosticCode(issue)).toBe('E_CSS_PARSE')
    expect(
      diagnosticCode(
        Object.assign(named('ModuleParseError', 'Module parse failed'), {
          module: {resource: '/proj/content/scripts.js'}
        })
      )
    ).toBeUndefined()
  })

  it('leaves an unknown diagnostic without a code', () => {
    expect(diagnosticCode(new Error('something else'))).toBeUndefined()
    expect(diagnosticCode(named('ExtensionError'))).toBeUndefined()
    expect(diagnosticCode('a string')).toBeUndefined()
    expect(diagnosticCode(null)).toBeUndefined()
  })
})

// Classes the build only ever fails on, so none of them has a W_ name.
const ERRORS_ONLY = new Set<ErrorCode>([
  CODES.E_BACKGROUND_REQUIRED,
  CODES.E_CONTENT_SCRIPT_SYNTAX,
  CODES.E_MANIFEST_NOT_FOUND,
  CODES.E_COMPILE,
  CODES.E_ASSET_IMPORT_SHAPE
])

const WARNING_NAMES = Object.values(CODES).filter((code) =>
  code.startsWith('W_')
)

describe('the warning class', () => {
  it('keeps the E_ name a warning shipped under and names its W_ code beside it', () => {
    expect(codeForSeverity(CODES.E_ASSET_MISSING, 'warning')).toEqual({
      code: 'E_ASSET_MISSING',
      warningCode: 'W_ASSET_MISSING'
    })

    expect(codeForSeverity(CODES.W_ASSET_MISSING, 'warning')).toEqual({
      code: 'E_ASSET_MISSING',
      warningCode: 'W_ASSET_MISSING'
    })
  })

  it('leaves an error under its E_ name with no warning name', () => {
    expect(codeForSeverity(CODES.E_ASSET_MISSING, 'error')).toEqual({
      code: 'E_ASSET_MISSING'
    })

    expect(codeForSeverity(CODES.E_JSON_INVALID, 'error')).toEqual({
      code: 'E_JSON_INVALID'
    })
  })

  it('gives a class born as a warning its W_ name in both places', () => {
    expect(codeForSeverity(CODES.W_STORE_READINESS, 'warning')).toEqual({
      code: 'W_STORE_READINESS',
      warningCode: 'W_STORE_READINESS'
    })
  })

  it('splits a new class with errors and warnings by the prefix alone', () => {
    expect(codeForSeverity(CODES.E_JSON_INVALID, 'warning')).toEqual({
      code: 'W_JSON_INVALID',
      warningCode: 'W_JSON_INVALID'
    })

    expect(codeForSeverity(CODES.W_JSON_INVALID, 'error')).toEqual({
      code: 'E_JSON_INVALID'
    })

    expect(codeForSeverity(CODES.E_MANIFEST_INVALID, 'warning')).toEqual({
      code: 'W_MANIFEST_INVALID',
      warningCode: 'W_MANIFEST_INVALID'
    })
  })

  it('keeps a warning-only class on its W_ name when a build fails on it', () => {
    expect(codeForSeverity(CODES.W_STORE_READINESS, 'error')).toEqual({
      code: 'W_STORE_READINESS'
    })
  })

  it('leaves a class with no W_ name as it is on a warning', () => {
    expect(warningCodeOf(CODES.E_COMPILE)).toBeUndefined()
    expect(codeForSeverity(CODES.E_COMPILE, 'warning')).toEqual({
      code: 'E_COMPILE'
    })
  })

  it('carries both names on the diagnostic a frame lists', () => {
    expect(toDiagnostic(named('PerfBudgetWarning'), 'warning')).toEqual({
      code: 'E_PERF_BUDGET',
      warningCode: 'W_PERF_BUDGET',
      message: 'text',
      severity: 'warning',
      name: 'PerfBudgetWarning'
    })

    expect(toDiagnostic(named('ScriptsMissingFile'), 'error')).toEqual({
      code: 'E_ENTRY_NOT_FOUND',
      message: 'text',
      severity: 'error',
      name: 'ScriptsMissingFile'
    })

    expect(toDiagnostic(named('EnvPublicSecretName'), 'warning')).toEqual({
      code: 'W_ENV_SECRET_PUBLIC',
      warningCode: 'W_ENV_SECRET_PUBLIC',
      message: 'text',
      severity: 'warning',
      name: 'EnvPublicSecretName'
    })

    expect(toDiagnostic(named('DNRDuplicateRuleId'), 'warning')).toEqual({
      code: 'W_JSON_INVALID',
      warningCode: 'W_JSON_INVALID',
      message: 'text',
      severity: 'warning',
      name: 'DNRDuplicateRuleId'
    })

    expect(toDiagnostic(named('DNRInvalidRule'), 'error')).toEqual({
      code: 'E_JSON_INVALID',
      message: 'text',
      severity: 'error',
      name: 'DNRInvalidRule'
    })
  })

  // The E_ names consumers match today. A row leaves this list in 5.0 and
  // not before, and no new row joins it.
  it('pins the warnings that keep an E_ name through 4.x', () => {
    expect(DEPRECATED_WARNING_NAMES).toEqual({
      W_MANAGED_DEP_CONFLICT: 'E_MANAGED_DEP_CONFLICT',
      W_TYPES_EMIT: 'E_TYPES_EMIT',
      W_MODULE_NOT_FOUND: 'E_MODULE_NOT_FOUND',
      W_ENTRY_NOT_FOUND: 'E_ENTRY_NOT_FOUND',
      W_ASSET_MISSING: 'E_ASSET_MISSING',
      W_SCRIPT_DEP_MISSING: 'E_SCRIPT_DEP_MISSING',
      W_CSS_PARSE: 'E_CSS_PARSE',
      W_CSS_PREPROCESSOR_MISSING: 'E_CSS_PREPROCESSOR_MISSING',
      W_CSS_DEAD_REF: 'E_CSS_DEAD_REF',
      W_POLYFILL_NOT_FOUND: 'E_POLYFILL_NOT_FOUND',
      W_LOCALES_LAYOUT: 'E_LOCALES_LAYOUT',
      W_PROD_LOOPBACK_ORIGIN: 'E_PROD_LOOPBACK_ORIGIN',
      W_NO_ENTRYPOINTS: 'E_NO_ENTRYPOINTS',
      W_REMOTE_RESOURCE_BLOCKED: 'E_REMOTE_RESOURCE_BLOCKED',
      W_PERF_BUDGET: 'E_PERF_BUDGET',
      W_ENV_NO_MATCH: 'E_ENV_NO_MATCH',
      W_LAUNCH_SKIPPED_COMPILE_ERRORS: 'E_LAUNCH_SKIPPED_COMPILE_ERRORS',
      W_UNINSTALL_NOOP: 'E_UNINSTALL_NOOP',
      W_PORT_IN_USE: 'E_PORT_IN_USE',
      W_LOGS_STREAM_GAP: 'E_LOGS_STREAM_GAP'
    })
  })

  it('finds the W_ names in the catalog', () => {
    expect(WARNING_NAMES.length).toBe(36)
  })

  it.each(
    WARNING_NAMES
  )('reports %s on a warning under one stable name', (code) => {
    const shipped = codeForSeverity(code, 'warning')

    expect(shipped.warningCode).toBe(code)
    expect([code, `E_${code.slice(2)}`]).toContain(shipped.code)
  })

  // A new E_ class in the table has to say whether it can warn: it gets a
  // W_ name beside it or a row in the errors-only list.
  it('gives every class a diagnostic can carry a W_ name or marks it errors-only', () => {
    const classes = new Set<ErrorCode>([
      ...Object.values(NAMED_CODES),
      CODES.E_MODULE_NOT_FOUND,
      CODES.E_CONTENT_SCRIPT_SYNTAX,
      CODES.E_CSS_PARSE
    ])
    const undecided = [...classes].filter(
      (code) => !warningCodeOf(code) && !ERRORS_ONLY.has(code)
    )

    expect(undecided).toEqual([])

    for (const code of ERRORS_ONLY) {
      expect(warningCodeOf(code), `${code} has a W_ name`).toBeUndefined()
    }
  })
})
