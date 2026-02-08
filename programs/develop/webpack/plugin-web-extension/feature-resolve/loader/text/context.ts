// ██████╗ ███████╗███████╗ ██████╗ ██╗    ██╗   ██╗███████╗
// ██╔══██╗██╔════╝██╔════╝██╔═══██╗██║    ██║   ██║██╔════╝
// ██████╔╝█████╗  ███████╗██║   ██║██║    ██║   ██║█████╗
// ██╔══██╗██╔══╝  ╚════██║██║   ██║██║    ╚██╗ ██╔╝██╔══╝
// ██║  ██║███████╗███████║╚██████╔╝███████╗╚████╔╝ ███████╗
// ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚══════╝ ╚═══╝  ╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import {resolveLiteralToOutput} from '../../resolve-lib'

export type TextTransformContext = {
  manifestPath: string
  packageJsonDir?: string
  authorFilePath?: string
  onResolvedLiteral?: (
    original: string,
    computed: string | undefined,
    atIndex?: number
  ) => void
}

export function isJsxLikePath(filePath: string | undefined): boolean {
  return typeof filePath === 'string' && /\.[cm]?[jt]sx$/.test(String(filePath))
}

export function stripNestedQuotes(value: string): string {
  const match = /^(['"])(.*)\1$/.exec(value)
  return match ? match[2] : value
}

export function normalizeLiteralPayload(value: string): string {
  const withForwardSlashes = value.replace(/\\/g, '/')
  const withCollapsed = withForwardSlashes.replace(/\/{2,}/g, '/')
  return stripNestedQuotes(withCollapsed)
}

export function isLikelyApiContextAt(
  source: string,
  atIndex: number | undefined
): boolean {
  if (typeof atIndex !== 'number') return false
  const start = Math.max(0, atIndex - 200)
  const neighborhood = source.slice(start, atIndex)
  return /(chrome|browser)\s*\.(?:tabs|windows|scripting|action|sidePanel|sidebarAction|devtools|runtime|extension)\b/.test(
    neighborhood
  )
}

export function resolveAndNormalizeLiteral(
  literal: string,
  ctx: Pick<
    TextTransformContext,
    'manifestPath' | 'packageJsonDir' | 'authorFilePath'
  >
): string | undefined {
  const normalizedInput = normalizeLiteralPayload(literal)
  const resolved = resolveLiteralToOutput(normalizedInput, {
    manifestPath: ctx.manifestPath,
    packageJsonDir: ctx.packageJsonDir,
    authorFilePath: ctx.authorFilePath
  })
  return normalizeLiteralPayload(resolved ?? normalizedInput)
}
