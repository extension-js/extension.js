import {describe, expect, it} from 'vitest'
import {diagnosticCode, diagnosticName} from '../diagnostic-code'

function named(name: string, message = 'text') {
  return Object.assign(new Error(message), {name})
}

describe('diagnosticCode', () => {
  it.each([
    ['WARInvalidMatchPattern', 'E_WAR_INVALID'],
    ['WARStringEntryInMv3', 'E_WAR_INVALID'],
    ['LocalesLayoutWarning', 'E_LOCALES_LAYOUT'],
    ['LocalesFolderWithoutMessages', 'E_LOCALES_LAYOUT'],
    ['LocalesValidationError', 'E_LOCALES_LAYOUT'],
    ['PerfBudgetWarning', 'E_PERF_BUDGET'],
    ['PerfBudgetError', 'E_PERF_BUDGET'],
    ['EnvNoMatchingFile', 'E_ENV_NO_MATCH'],
    ['JSONMissingFile', 'E_ENTRY_NOT_FOUND'],
    ['LocalesPluginMissingFile', 'E_ENTRY_NOT_FOUND'],
    ['HtmlEntrypointMissing', 'E_ENTRY_NOT_FOUND'],
    ['ScriptsMissingFile', 'E_ENTRY_NOT_FOUND'],
    ['ManifestPageMissing', 'E_ENTRY_NOT_FOUND'],
    ['ManifestFilesNotEmitted', 'E_ENTRY_NOT_FOUND'],
    ['ManifestNamedFileNotShipped', 'E_ENTRY_NOT_FOUND'],
    ['IconsMissingFile', 'E_ASSET_MISSING'],
    ['HtmlAssetMissing', 'E_ASSET_MISSING'],
    ['HtmlPublicAssetMissing', 'E_ASSET_MISSING'],
    ['WARRelativeAssetMissing', 'E_ASSET_MISSING'],
    ['MissingCssAssetWarning', 'E_ASSET_MISSING'],
    ['RuntimeLoadedFileCompileFailed', 'E_SCRIPT_DEP_MISSING'],
    ['CodeNamedFileNotShipped', 'E_SCRIPT_DEP_MISSING'],
    ['RuntimeFetchedFileMissing', 'E_SCRIPT_DEP_MISSING'],
    ['ImportScriptsDependencyMissing', 'E_SCRIPT_DEP_MISSING'],
    ['InjectedScriptFilesMissing', 'E_SCRIPT_DEP_MISSING'],
    ['UnresolvedBareRequireWarning', 'E_SCRIPT_DEP_MISSING'],
    ['RemoteResourceBlocked', 'E_REMOTE_RESOURCE_BLOCKED'],
    ['ReservedScriptsFolder', 'E_RESERVED_FOLDER'],
    ['CssPreprocessorMissing', 'E_CSS_PREPROCESSOR_MISSING'],
    ['CssDeadRef', 'E_CSS_DEAD_REF'],
    ['CssWithheldRef', 'E_CSS_DEAD_REF'],
    ['CssParseWarning', 'E_CSS_PARSE'],
    ['BackgroundRequired', 'E_BACKGROUND_REQUIRED'],
    ['ContentScriptSyntax', 'E_CONTENT_SCRIPT_SYNTAX']
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
