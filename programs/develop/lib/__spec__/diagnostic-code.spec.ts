import {describe, expect, it, vi} from 'vitest'
import {toDiagnostic} from '../compilation-diagnostics'
import {
  codeForSeverity,
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
    ['PerfBudgetWarning', 'W_PERF_BUDGET'],
    ['PerfBudgetError', 'E_PERF_BUDGET'],
    ['EnvNoMatchingFile', 'W_ENV_NO_MATCH'],
    ['JSONMissingFile', 'E_ENTRY_NOT_FOUND'],
    ['LocalesPluginMissingFile', 'E_ENTRY_NOT_FOUND'],
    ['HtmlEntrypointMissing', 'E_ENTRY_NOT_FOUND'],
    ['ScriptsMissingFile', 'E_ENTRY_NOT_FOUND'],
    ['ManifestPageMissing', 'E_ENTRY_NOT_FOUND'],
    ['ManifestFilesNotEmitted', 'E_ENTRY_NOT_FOUND'],
    ['JSONPathIsFolder', 'E_ENTRY_NOT_FOUND'],
    ['ManifestNamedFileNotShipped', 'E_ENTRY_NOT_FOUND'],
    ['IconsMissingFile', 'E_ASSET_MISSING'],
    ['HtmlAssetMissing', 'E_ASSET_MISSING'],
    ['HtmlPublicAssetMissing', 'E_ASSET_MISSING'],
    ['WARRelativeAssetMissing', 'E_ASSET_MISSING'],
    ['MissingCssAssetWarning', 'E_ASSET_MISSING'],
    ['PublicFolderOffRef', 'E_ASSET_MISSING'],
    ['RootAbsoluteRefCompiledSource', 'E_ASSET_MISSING'],
    ['RuntimeSetSurfaceFileMissing', 'E_ASSET_MISSING'],
    ['RuntimeLoadedFileCompileFailed', 'E_SCRIPT_DEP_MISSING'],
    ['CodeNamedFileNotShipped', 'E_SCRIPT_DEP_MISSING'],
    ['RuntimeFetchedFileMissing', 'E_SCRIPT_DEP_MISSING'],
    ['ImportScriptsDependencyMissing', 'E_SCRIPT_DEP_MISSING'],
    ['InjectedScriptFilesMissing', 'E_SCRIPT_DEP_MISSING'],
    ['UnresolvedBareRequireWarning', 'E_SCRIPT_DEP_MISSING'],
    ['ImportScriptsCompiledSource', 'E_SCRIPT_DEP_MISSING'],
    ['InjectedScriptCompiledSource', 'E_SCRIPT_DEP_MISSING'],
    ['RuntimeStaticImportFileMissing', 'E_SCRIPT_DEP_MISSING'],
    ['RuntimeGetURLFileMissing', 'E_SCRIPT_DEP_MISSING'],
    ['RuntimeGetURLCompiledSource', 'E_SCRIPT_DEP_MISSING'],
    ['RuntimeAssetFolderNotShipped', 'E_SCRIPT_DEP_MISSING'],
    ['MovedPageRelativeUrl', 'E_SCRIPT_DEP_MISSING'],
    ['WebkitDroppedPageOpened', 'E_SCRIPT_DEP_MISSING'],
    ['NodeBuiltinNotAvailable', 'E_MODULE_NOT_FOUND'],
    ['RemoteResourceBlocked', 'W_REMOTE_RESOURCE_BLOCKED'],
    ['ReservedScriptsFolder', 'E_RESERVED_FOLDER'],
    ['ScriptsFolderEntryOnlyImported', 'W_RESERVED_FOLDER'],
    ['CssPreprocessorMissing', 'E_CSS_PREPROCESSOR_MISSING'],
    ['CssDeadRef', 'E_CSS_DEAD_REF'],
    ['CssWithheldRef', 'E_CSS_DEAD_REF'],
    ['CssParseWarning', 'E_CSS_PARSE'],
    ['CssMinifierDroppedRules', 'E_CSS_PARSE'],
    ['BackgroundRequired', 'E_BACKGROUND_REQUIRED'],
    ['ContentScriptSyntax', 'E_CONTENT_SCRIPT_SYNTAX'],
    ['ManifestNotFoundError', 'E_MANIFEST_NOT_FOUND'],
    ['ManifestFatalShapeWarning', 'W_MANIFEST_INVALID'],
    ['MainWorldScriptCompileFailed', 'E_COMPILE'],
    ['ContentScriptDevServerRuntimeWarning', 'W_INTERNAL'],
    ['ScriptsPathCheckFailed', 'E_INTERNAL'],
    ['CssUrlRewriteWarning', 'W_INTERNAL'],
    ['SpecialFoldersRemoval', 'E_RESTART_REQUIRED'],
    ['HtmlEntrypointChanged', 'E_RESTART_REQUIRED'],
    ['EnvFileChange', 'W_RESTART_REQUIRED'],
    ['ProjectConfigChange', 'W_RESTART_REQUIRED'],
    ['SpecialFoldersChange', 'W_RESTART_REQUIRED'],
    ['MainWorldRegistrationChange', 'W_RESTART_REQUIRED'],
    ['PublicFolderAppearedWarning', 'W_RESTART_REQUIRED'],
    ['CssSetupWarning', 'W_RESTART_REQUIRED'],
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
    ['ManifestPersistFailed', 'E_OUTPUT_NOT_WRITABLE'],
    ['PublicFolderShadowedWarning', 'W_PROJECT_LAYOUT'],
    ['PublicLayoutWarning', 'W_PROJECT_LAYOUT'],
    ['ExcludeFilesWarning', 'W_PROJECT_LAYOUT'],
    ['ScriptsFolderFilesLeftOutWarning', 'W_PROJECT_LAYOUT'],
    ['PublicEnvFilesWarning', 'W_PROJECT_LAYOUT'],
    ['PublicLinkedFilesWarning', 'W_PROJECT_LAYOUT'],
    ['NamespaceImportReadAsValue', 'E_ASSET_IMPORT_SHAPE'],
    ['ManifestV2OnChromiumWarning', 'W_MANIFEST_COMPAT'],
    ['ManifestLegacyWarning', 'W_MANIFEST_COMPAT'],
    ['ManifestHostPermissionWarning', 'W_MANIFEST_COMPAT'],
    ['GeckoAddonIdWarning', 'W_MANIFEST_COMPAT'],
    ['WebAssemblyPolicyWarning', 'W_MANIFEST_COMPAT'],
    ['ManifestDescriptionWarning', 'W_STORE_READINESS'],
    ['AmoDataCollectionWarning', 'W_STORE_READINESS'],
    ['RemoteWebAssemblyWarning', 'W_STORE_READINESS'],
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
    ['EnvPrivatePlaceholder', 'W_BUILD_CONSTANT_UNDEFINED'],
    ['EnvReservedName', 'W_ENV_NAME_RESERVED'],
    ['EnvDefinedNameWritten', 'W_ENV_DEFINE_WRITTEN'],
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
  CODES.E_ASSET_IMPORT_SHAPE,
  CODES.E_OUTPUT_NOT_WRITABLE,
  CODES.E_THEME_INVALID,
  CODES.E_FOLDER_UNREADABLE,
  CODES.E_MANIFEST_IN_PUBLIC,
  CODES.E_PROJECT_DOWNLOAD_EMPTY
])

const WARNING_NAMES = Object.values(CODES).filter((code) =>
  code.startsWith('W_')
)

describe('the warning class', () => {
  it('reports a warning under the W_ name of its class', () => {
    expect(codeForSeverity(CODES.E_ASSET_MISSING, 'warning')).toBe(
      'W_ASSET_MISSING'
    )

    expect(codeForSeverity(CODES.W_ASSET_MISSING, 'warning')).toBe(
      'W_ASSET_MISSING'
    )

    expect(codeForSeverity(CODES.E_JSON_INVALID, 'warning')).toBe(
      'W_JSON_INVALID'
    )

    expect(codeForSeverity(CODES.E_MODULE_NOT_FOUND, 'warning')).toBe(
      'W_MODULE_NOT_FOUND'
    )

    expect(codeForSeverity(CODES.E_CSS_PREPROCESSOR_MISSING, 'warning')).toBe(
      'W_CSS_PREPROCESSOR_MISSING'
    )
  })

  it('reports an error under the E_ name of its class', () => {
    expect(codeForSeverity(CODES.E_ASSET_MISSING, 'error')).toBe(
      'E_ASSET_MISSING'
    )

    expect(codeForSeverity(CODES.W_JSON_INVALID, 'error')).toBe(
      'E_JSON_INVALID'
    )
  })

  // The bundler opens a warning with its own glyph, not the error one.
  it('codes a module the bundler could not find and warned about', () => {
    const warning = new Error("  ⚠ Module not found: Can't resolve './nope'")

    expect(toDiagnostic(warning, 'warning').code).toBe('W_MODULE_NOT_FOUND')
    expect(
      toDiagnostic(
        new Error("  × Module not found: Can't resolve 'x'"),
        'error'
      ).code
    ).toBe('E_MODULE_NOT_FOUND')
  })

  it('refuses a warning-only class on an error', () => {
    expect(() => codeForSeverity(CODES.W_STORE_READINESS, 'error')).toThrow(
      'W_STORE_READINESS has no E_ name in CODES'
    )
  })

  it('refuses an errors-only class on a warning', () => {
    expect(warningCodeOf(CODES.E_COMPILE)).toBeUndefined()
    expect(() => codeForSeverity(CODES.E_COMPILE, 'warning')).toThrow(
      'E_COMPILE has no W_ name in CODES'
    )
  })

  it('reports a budget overrun under the name of its severity', () => {
    expect(codeForSeverity(CODES.W_PERF_BUDGET, 'error')).toBe('E_PERF_BUDGET')
    expect(codeForSeverity(CODES.E_PERF_BUDGET, 'warning')).toBe(
      'W_PERF_BUDGET'
    )
  })

  // Every code, both severities: an error never reads W_ and a warning
  // never reads E_, whether the pairing throws or resolves.
  it.each(
    Object.values(CODES)
  )('reports %s under the prefix of the severity or not at all', (code) => {
    for (const [severity, prefix] of [
      ['error', 'E_'],
      ['warning', 'W_']
    ] as const) {
      const twin = `${prefix}${code.slice(2)}`

      if (Object.hasOwn(CODES, twin)) {
        expect(codeForSeverity(code, severity)).toBe(twin)
      } else {
        expect(() => codeForSeverity(code, severity)).toThrow(
          `${code} has no ${prefix} name in CODES`
        )
      }
    }
  })

  it('drops the code on a user run where the class has no name for the severity', () => {
    vi.stubEnv('VITEST', '')
    vi.stubEnv('EXTENSION_AUTHOR_MODE', '')
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      for (const code of Object.values(CODES)) {
        expect(codeForSeverity(code, 'error') ?? 'E_').toMatch(/^E_/)
        expect(codeForSeverity(code, 'warning') ?? 'W_').toMatch(/^W_/)
      }

      expect(codeForSeverity(CODES.E_COMPILE, 'warning')).toBeUndefined()
      expect(toDiagnostic(named('BackgroundRequired'), 'warning')).toEqual({
        message: 'text',
        severity: 'warning',
        name: 'BackgroundRequired'
      })

      expect(stderr).not.toHaveBeenCalled()
    } finally {
      stderr.mockRestore()
      vi.unstubAllEnvs()
    }
  })

  // An author's run is a real session too, so it is told and carries on.
  it('tells an author in one stderr line and drops the code, without throwing', () => {
    vi.stubEnv('VITEST', '')
    vi.stubEnv('EXTENSION_AUTHOR_MODE', 'true')
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      expect(codeForSeverity(CODES.E_COMPILE, 'warning')).toBeUndefined()
      // A rebuild meets the same gap again, and the line is not repeated.
      expect(codeForSeverity(CODES.E_COMPILE, 'warning')).toBeUndefined()
      expect(stderr).toHaveBeenCalledTimes(1)
      expect(String(stderr.mock.calls[0][0])).toContain(
        'E_COMPILE has no W_ name in CODES, so it cannot be reported as a warning.'
      )

      expect(codeForSeverity(CODES.E_ASSET_MISSING, 'warning')).toBe(
        'W_ASSET_MISSING'
      )

      expect(stderr).toHaveBeenCalledTimes(1)
    } finally {
      stderr.mockRestore()
      vi.unstubAllEnvs()
    }
  })

  it('carries one code on the diagnostic a frame lists', () => {
    expect(toDiagnostic(named('HtmlAssetMissing'), 'warning')).toEqual({
      code: 'W_ASSET_MISSING',
      message: 'text',
      severity: 'warning',
      name: 'HtmlAssetMissing'
    })

    expect(toDiagnostic(named('IconsMissingFile'), 'error')).toEqual({
      code: 'E_ASSET_MISSING',
      message: 'text',
      severity: 'error',
      name: 'IconsMissingFile'
    })

    expect(toDiagnostic(named('EnvPublicSecretName'), 'warning')).toEqual({
      code: 'W_ENV_SECRET_PUBLIC',
      message: 'text',
      severity: 'warning',
      name: 'EnvPublicSecretName'
    })

    expect(toDiagnostic(named('DNRDuplicateRuleId'), 'warning')).toEqual({
      code: 'W_JSON_INVALID',
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

  it('finds the W_ names in the catalog', () => {
    expect(WARNING_NAMES.length).toBe(44)
  })

  it.each(WARNING_NAMES)('reports %s on a warning as it is', (code) => {
    expect(codeForSeverity(code, 'warning')).toBe(code)
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
