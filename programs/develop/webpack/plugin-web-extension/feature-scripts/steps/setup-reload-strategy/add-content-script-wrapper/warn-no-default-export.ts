// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import fs from 'fs'
import path from 'path'
import {findNearestPackageJsonSync} from '../../../../../webpack-lib/package-json'
import {parseSync, type ParseOptions} from '@swc/core'
import {validate} from 'schema-utils'
import {type Schema} from 'schema-utils/declarations/validate'
import {type LoaderContext} from '../../../../../webpack-types'

const schema: Schema = {
  type: 'object',
  properties: {
    test: {
      type: 'string'
    },
    manifestPath: {
      type: 'string'
    },
    mode: {
      type: 'string'
    }
  }
}

function getSourceSignature(source: string): string {
  // Cheap, stable-ish signature to avoid reparsing on repeated loader passes.
  // Not cryptographic; collisions are acceptable (worst case: extra parse or a reused result).
  const head = source.slice(0, 64)
  const tail = source.slice(-64)
  return `${source.length}:${head}:${tail}`
}

type DefaultExportKind = 'function' | 'class' | 'other' | 'unknown' | 'none'

type DefaultExportAnalysis = {
  hasDefaultExport: boolean
  kind: DefaultExportKind
}

function analyzeDefaultExport(
  source: string,
  resourcePath: string,
  compilation: any
): DefaultExportAnalysis {
  const abs = path.normalize(resourcePath)
  const sig = getSourceSignature(source)
  const cacheKey = `${abs}|${sig}`

  try {
    const compilationAny = compilation as any
    if (compilationAny) {
      compilationAny.__extjsDefaultExportAnalysisCache ??= new Map<
        string,
        DefaultExportAnalysis
      >()
      const cached = (
        compilationAny.__extjsDefaultExportAnalysisCache as Map<
          string,
          DefaultExportAnalysis
        >
      ).get(cacheKey)
      if (cached) return cached
    }

    const ext = path.extname(resourcePath).toLowerCase()
    const isTS =
      ext === '.ts' || ext === '.tsx' || ext === '.mts' || ext === '.mtsx'
    const isJSX =
      ext === '.jsx' || ext === '.tsx' || ext === '.mjsx' || ext === '.mtsx'

    const ast = parseSync(source, {
      syntax: isTS ? 'typescript' : 'ecmascript',
      tsx: isTS && isJSX,
      jsx: !isTS && isJSX,
      decorators: true,
      dynamicImport: true,
      importAssertions: true,
      topLevelAwait: true
    } as ParseOptions)

    const body = Array.isArray((ast as {body?: unknown})?.body)
      ? (ast as {body: unknown[]}).body
      : []

    const bindings = new Map<string, DefaultExportKind>()
    const recordBinding = (name: unknown, kind: DefaultExportKind) => {
      if (typeof name === 'string' && name) bindings.set(name, kind)
    }

    const inspectDecl = (node: Record<string, unknown>) => {
      if (node.type === 'FunctionDeclaration') {
        const id = node.identifier as Record<string, unknown> | undefined
        recordBinding(id?.value, 'function')
      } else if (node.type === 'ClassDeclaration') {
        const id = node.identifier as Record<string, unknown> | undefined
        recordBinding(id?.value, 'class')
      } else if (node.type === 'VariableDeclaration') {
        const decls = node.declarations as unknown
        if (!Array.isArray(decls)) return
        for (const d of decls) {
          if (!d || typeof d !== 'object') continue
          const dd = d as Record<string, unknown>
          const id = dd.id as Record<string, unknown> | undefined
          const init = dd.init as Record<string, unknown> | undefined
          if (id?.type !== 'Identifier') continue
          const name = id.value
          const initType = init?.type
          if (
            initType === 'FunctionExpression' ||
            initType === 'ArrowFunctionExpression'
          ) {
            recordBinding(name, 'function')
          } else if (initType === 'ClassExpression') {
            recordBinding(name, 'class')
          } else if (initType) {
            recordBinding(name, 'other')
          }
        }
      }
    }

    for (const item of body) {
      if (!item || typeof item !== 'object') continue
      const it = item as Record<string, unknown>
      if (
        it.type === 'FunctionDeclaration' ||
        it.type === 'ClassDeclaration' ||
        it.type === 'VariableDeclaration'
      ) {
        inspectDecl(it)
      }
      if (it.type === 'ExportNamedDeclaration') {
        const decl = it.declaration as Record<string, unknown> | undefined
        if (decl && typeof decl === 'object') inspectDecl(decl)
      }
    }

    const resolveIdentifierKind = (name: string): DefaultExportKind => {
      return bindings.get(name) ?? 'unknown'
    }

    const analysis: DefaultExportAnalysis = {
      hasDefaultExport: false,
      kind: 'none'
    }

    for (const item of body) {
      if (!item || typeof item !== 'object') continue
      const it = item as Record<string, unknown>

      if (it.type === 'ExportDefaultDeclaration') {
        analysis.hasDefaultExport = true
        const decl = it.decl as Record<string, unknown> | undefined
        const declType = decl?.type
        if (
          declType === 'FunctionDeclaration' ||
          declType === 'FunctionExpression'
        ) {
          analysis.kind = 'function'
        } else if (
          declType === 'ClassDeclaration' ||
          declType === 'ClassExpression'
        ) {
          analysis.kind = 'class'
        } else analysis.kind = 'other'
        break
      }

      if (it.type === 'ExportDefaultExpression') {
        analysis.hasDefaultExport = true
        const expr = it.expression as Record<string, unknown> | undefined
        const exprType = expr?.type
        if (
          exprType === 'FunctionExpression' ||
          exprType === 'ArrowFunctionExpression'
        ) {
          analysis.kind = 'function'
        } else if (exprType === 'ClassExpression') {
          analysis.kind = 'class'
        } else if (
          exprType === 'Identifier' &&
          typeof expr?.value === 'string'
        ) {
          analysis.kind = resolveIdentifierKind(expr.value as string)
        } else {
          analysis.kind = 'other'
        }
        break
      }

      // export { foo as default }
      if (
        it.type === 'ExportNamedDeclaration' &&
        Array.isArray(it.specifiers)
      ) {
        for (const specifier of it.specifiers as unknown[]) {
          if (!specifier || typeof specifier !== 'object') continue
          const spec = specifier as Record<string, unknown>
          if (spec.type !== 'ExportSpecifier') continue
          const exported = spec.exported as Record<string, unknown> | undefined
          const orig = spec.orig as Record<string, unknown> | undefined
          const exportedType = exported?.type
          const exportedValue = (exported as any)?.value
          const isDefault =
            exportedType === 'Identifier'
              ? exportedValue === 'default'
              : exportedType === 'Ident'
                ? exportedValue === 'default'
                : exportedType === 'Str'
                  ? exportedValue === 'default'
                  : false
          if (!isDefault) continue

          analysis.hasDefaultExport = true
          if (
            orig?.type === 'Identifier' &&
            typeof (orig as any)?.value === 'string'
          ) {
            analysis.kind = resolveIdentifierKind((orig as any).value as string)
          } else {
            analysis.kind = 'unknown'
          }
          break
        }
        if (analysis.hasDefaultExport) break
      }
    }

    if (compilationAny) {
      ;(
        compilationAny.__extjsDefaultExportAnalysisCache as Map<
          string,
          DefaultExportAnalysis
        >
      ).set(cacheKey, analysis)
    }
    return analysis
  } catch {
    const fallback: DefaultExportAnalysis = source.includes('export default')
      ? {hasDefaultExport: true, kind: 'unknown'}
      : {hasDefaultExport: false, kind: 'none'}
    try {
      const compilationAny = compilation as any
      if (compilationAny?.__extjsDefaultExportAnalysisCache) {
        ;(
          compilationAny.__extjsDefaultExportAnalysisCache as Map<
            string,
            DefaultExportAnalysis
          >
        ).set(cacheKey, fallback)
      }
    } catch {
      // ignore
    }
    return fallback
  }
}

function hasDefaultExport(
  source: string,
  resourcePath: string,
  compilation: any
): boolean {
  try {
    const ext = path.extname(resourcePath).toLowerCase()
    const isTS =
      ext === '.ts' || ext === '.tsx' || ext === '.mts' || ext === '.mtsx'
    const isJSX =
      ext === '.jsx' || ext === '.tsx' || ext === '.mjsx' || ext === '.mtsx'

    const abs = path.normalize(resourcePath)
    const sig = getSourceSignature(source)
    if (compilation) {
      compilation.__extjsHasDefaultExportCache ??= new Map<string, boolean>()
      const cacheKey = `${abs}|${sig}`
      const cached = compilation.__extjsHasDefaultExportCache.get(cacheKey)
      if (typeof cached === 'boolean') return cached
    }

    const ast = parseSync(source, {
      syntax: isTS ? 'typescript' : 'ecmascript',
      tsx: isTS && isJSX,
      jsx: !isTS && isJSX,
      decorators: true,
      dynamicImport: true,
      importAssertions: true,
      topLevelAwait: true
    } as ParseOptions)

    const body = Array.isArray((ast as {body?: unknown})?.body)
      ? (ast as {body: unknown[]}).body
      : []
    for (const item of body) {
      if (!item || typeof item !== 'object') continue
      // Narrow type for object item
      const it = item as Record<string, unknown>
      if (
        it.type === 'ExportDefaultDeclaration' ||
        it.type === 'ExportDefaultExpression'
      ) {
        if (compilation) {
          compilation.__extjsHasDefaultExportCache?.set(
            `${path.normalize(resourcePath)}|${getSourceSignature(source)}`,
            true
          )
        }
        return true
      }

      // Covers: export { foo as default } and re-exports that include default.
      if (
        it.type === 'ExportNamedDeclaration' &&
        Array.isArray(it.specifiers)
      ) {
        for (const specifier of it.specifiers as unknown[]) {
          if (!specifier || typeof specifier !== 'object') continue
          const spec = specifier as Record<string, unknown>
          if (spec.type === 'ExportDefaultSpecifier') return true
          if (spec.type === 'ExportSpecifier') {
            const exported = spec.exported as
              | {type: string; value?: unknown}
              | undefined
            if (
              exported &&
              typeof exported === 'object' &&
              ((exported.type === 'Identifier' &&
                exported.value === 'default') ||
                (exported.type === 'Ident' && exported.value === 'default') ||
                (exported.type === 'Str' && exported.value === 'default'))
            ) {
              if (compilation) {
                compilation.__extjsHasDefaultExportCache?.set(
                  `${path.normalize(resourcePath)}|${getSourceSignature(source)}`,
                  true
                )
              }
              return true
            }
          }
        }
      }
    }
    if (compilation) {
      compilation.__extjsHasDefaultExportCache?.set(
        `${path.normalize(resourcePath)}|${getSourceSignature(source)}`,
        false
      )
    }
    return false
  } catch {
    // If parsing fails (such as in-progress syntax error during development),
    // fall back to a cheap substring check to avoid noisy false warnings.
    const fallback = source.includes('export default')
    try {
      compilation?.__extjsHasDefaultExportCache?.set(
        `${path.normalize(resourcePath)}|${getSourceSignature(source)}`,
        fallback
      )
    } catch {
      // ignore
    }
    return fallback
  }
}

export default function (this: LoaderContext, source: string) {
  const options = this.getOptions()
  const manifestPath = options.manifestPath
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))

  // Skip the synthetic "inner" request to avoid double-processing.
  // The wrapper triggers a second pass with ?__extjs_inner=1.
  const resourceQuery = (this as any).resourceQuery as string | undefined

  if (
    typeof resourceQuery === 'string' &&
    resourceQuery.includes('__extjs_inner=1')
  ) {
    return source
  }

  validate(schema, options, {
    name: 'scripts:warn-no-default-export',
    baseDataPath: 'options'
  })

  // Warn when a content script module lacks a default export
  try {
    const resourceAbsPath = path.normalize(this.resourcePath)
    const manifestDir = path.dirname(manifestPath)
    const packageJsonPath = findNearestPackageJsonSync(manifestPath)
    const packageJsonDir = packageJsonPath
      ? path.dirname(packageJsonPath)
      : manifestDir
    const compilation: any = (this as any)._compilation

    // Deduplicate warnings per compilation per file
    const dedupeKey = `no-default:${resourceAbsPath}`
    if (compilation) {
      compilation.__extjsWarnedDefaultExport ??= new Set<string>()
      if (compilation.__extjsWarnedDefaultExport.has(dedupeKey)) {
        return source
      }
    }

    const declaredContentJsAbsPaths: string[] = []
    const contentScripts = Array.isArray(manifest.content_scripts)
      ? manifest.content_scripts
      : []

    for (const contentScript of contentScripts) {
      const contentScriptJsList = Array.isArray(contentScript?.js)
        ? contentScript.js
        : []

      for (const contentScriptJs of contentScriptJsList) {
        declaredContentJsAbsPaths.push(
          path.resolve(manifestDir, contentScriptJs as string)
        )
      }
    }

    const isDeclaredContentScript = declaredContentJsAbsPaths.some(
      (abs) => resourceAbsPath === path.normalize(abs)
    )

    const scriptsDir = path.resolve(packageJsonDir, 'scripts')
    const relToScripts = path.relative(scriptsDir, resourceAbsPath)
    const isScriptsFolderScript =
      relToScripts &&
      !relToScripts.startsWith('..') &&
      !path.isAbsolute(relToScripts)

    const isContentScriptLike = isDeclaredContentScript || isScriptsFolderScript

    if (isContentScriptLike) {
      const analysis = analyzeDefaultExport(
        source,
        this.resourcePath,
        compilation
      )
      if (!analysis.hasDefaultExport) {
        const relativeFile = path.relative(packageJsonDir, resourceAbsPath)
        const message = [
          'Content script requires a default export.',
          `File: ${relativeFile}`,
          ``,
          `Why:`,
          `  - During development, Extension.js uses your default export to start and stop your content script safely.`,
          `  - Without it, automatic reloads and cleanup might not work reliably.`,
          ``,
          `Required:`,
          `  - Export a default function (it can optionally return a cleanup callback).`,
          ``,
          `Example:`,
          `  export default function main() {`,
          `    // setup...`,
          `    return () => { /* cleanup */ }`,
          `  }`,
          ``,
          `Side effects if omitted:`,
          `  - Duplicate UI mounts, memory leaks, and inconsistent state during development.`
        ].join('\n')

        // Prefer a compilation-level warning to avoid the noisy "Module Warning (from loader)" prefix.
        // Push as a string so the header becomes: "WARNING in Content script requires a default export."
        compilation?.warnings.push(message)
        compilation?.__extjsWarnedDefaultExport?.add(dedupeKey)
      } else if (analysis.kind === 'class' || analysis.kind === 'other') {
        // Warn when the default export is provably not callable as a function (classes, objects, literals, etc).
        const dedupeKindKey = `default-not-callable:${resourceAbsPath}`
        if (compilation) {
          compilation.__extjsWarnedDefaultExportKinds ??= new Set<string>()
          if (compilation.__extjsWarnedDefaultExportKinds.has(dedupeKindKey)) {
            return source
          }
        }

        const relativeFile = path.relative(packageJsonDir, resourceAbsPath)
        const found = analysis.kind === 'class' ? 'class' : 'non-callable value'
        const message = [
          'Content script default export must be a function.',
          `File: ${relativeFile}`,
          ``,
          `Found: ${found}`,
          ``,
          `Fix:`,
          `  - Export a default function that sets up your script and returns optional cleanup.`,
          `  - If you want to use a class, instantiate it inside the default function and call its methods.`,
          ``,
          `Example:`,
          `  class App { start(){} stop(){} }`,
          `  export default function main(){`,
          `    const app = new App(); app.start();`,
          `    return () => app.stop();`,
          `  }`
        ].join('\n')

        compilation?.warnings.push(message)
        compilation?.__extjsWarnedDefaultExportKinds?.add(dedupeKindKey)
      }
    }
  } catch {
    //Ignore errors
  }

  return source
}
