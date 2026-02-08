// ██████╗ ███████╗███████╗ ██████╗ ██╗    ██╗   ██╗███████╗
// ██╔══██╗██╔════╝██╔════╝██╔═══██╗██║    ██║   ██║██╔════╝
// ██████╔╝█████╗  ███████╗██║   ██║██║    ██║   ██║█████╗
// ██╔══██╗██╔══╝  ╚════██║██║   ██║██║    ╚██╗ ██╔╝██╔══╝
// ██║  ██║███████╗███████║╚██████╔╝███████╗╚████╔╝ ███████╗
// ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚══════╝ ╚═══╝  ╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import {resolveLiteralToOutput} from '../../resolve-lib'
import {
  TextTransformContext,
  isLikelyApiContextAt,
  normalizeLiteralPayload,
  resolveAndNormalizeLiteral
} from './context'

export function replaceRuntimeGetURL(
  source: string,
  input: string,
  ctx: TextTransformContext
): string {
  const rx = /(\.(?:runtime|extension)\.getURL\()\s*(['"])(.*?)\2(\))/g
  function onMatch(
    full: string,
    pre: string,
    q: string,
    p: string,
    post: string,
    offset: number
  ) {
    try {
      const resolved = resolveLiteralToOutput(normalizeLiteralPayload(p), {
        manifestPath: ctx.manifestPath,
        packageJsonDir: ctx.packageJsonDir,
        authorFilePath: ctx.authorFilePath
      })
      const computed = normalizeLiteralPayload(resolved ?? p)
      try {
        ctx.onResolvedLiteral?.(p, resolved ?? undefined, offset)
      } catch {}
      return `${pre}${q}${computed}${q}${post}`
    } catch {
      return full
    }
  }
  return input.replace(rx, onMatch as any)
}

export function replaceObjectKeyLiterals(
  source: string,
  input: string,
  keys: string[],
  ctx: TextTransformContext
): string {
  for (const key of keys) {
    const rx = new RegExp(`(${key}\\s*:\\s*)(['"])(.*?)\\2`, 'g')
    function onMatch(
      full: string,
      pre: string,
      q: string,
      p: string,
      offset: number
    ) {
      try {
        const resolved = resolveLiteralToOutput(normalizeLiteralPayload(p), {
          manifestPath: ctx.manifestPath,
          packageJsonDir: ctx.packageJsonDir,
          authorFilePath: ctx.authorFilePath
        })
        const computed = normalizeLiteralPayload(resolved ?? p)
        try {
          if (isLikelyApiContextAt(source, offset)) {
            ctx.onResolvedLiteral?.(p, resolved ?? undefined, offset)
          }
        } catch {
          // best-effort only
        }
        return `${pre}${q}${computed}${q}`
      } catch {
        return full
      }
    }
    input = input.replace(rx, onMatch as any)
  }
  return input
}

export function replaceStaticTemplateForKeys(
  source: string,
  input: string,
  keys: string[],
  ctx: TextTransformContext
): string {
  const rx = new RegExp(`((?:${keys.join('|')})\\s*:\\s*)\`([^\\\`$]*)\``, 'g')

  function onMatch(full: string, pre: string, inner: string, offset: number) {
    try {
      const resolved = resolveLiteralToOutput(normalizeLiteralPayload(inner), {
        manifestPath: ctx.manifestPath,
        packageJsonDir: ctx.packageJsonDir,
        authorFilePath: ctx.authorFilePath
      })
      const computed = normalizeLiteralPayload(resolved ?? inner)
      try {
        if (isLikelyApiContextAt(source, offset)) {
          ctx.onResolvedLiteral?.(inner, resolved ?? undefined, offset)
        }
      } catch {
        // best-effort only
      }

      return `${pre}'${computed}'`
    } catch {
      return full
    }
  }
  return input.replace(rx, onMatch as any)
}

export function replaceConcatForKeys(
  source: string,
  input: string,
  keys: string[],
  ctx: TextTransformContext
): string {
  const rx = new RegExp(
    `((?:${keys.join('|')})\\s*:\\s*)((?:['"][^'"]*['"]\\s*\\+\\s*)+['"][^'"]*['"])`,
    'g'
  )

  function onMatch(full: string, pre: string, expr: string, offset: number) {
    try {
      const partRe = /(['"])([^'"]*?)\1/g
      let m: RegExpExecArray | null
      let concatenated = ''

      while ((m = partRe.exec(expr))) concatenated += m[2]
      const resolved = resolveLiteralToOutput(
        normalizeLiteralPayload(concatenated),
        {
          manifestPath: ctx.manifestPath,
          packageJsonDir: ctx.packageJsonDir,
          authorFilePath: ctx.authorFilePath
        }
      )

      const computed = normalizeLiteralPayload(resolved ?? concatenated)
      try {
        if (isLikelyApiContextAt(source, offset)) {
          ctx.onResolvedLiteral?.(concatenated, resolved ?? undefined, offset)
        }
      } catch {
        // best-effort only
      }

      return `${pre}'${computed}'`
    } catch {
      return full
    }
  }
  return input.replace(rx, onMatch as any)
}

export function replaceFilesArray(
  source: string,
  input: string,
  ctx: TextTransformContext
): string {
  const rx = /(files\s*:\s*\[)([^\]]*)(\])/g
  function onMatch(
    full: string,
    pre: string,
    inner: string,
    post: string,
    offset: number
  ) {
    try {
      const replacedInner = inner.replace(
        /(['"])(.*?)(\1)/g,
        function onLiteral(_m: string, q: string, p: string) {
          try {
            const computed = resolveAndNormalizeLiteral(p, ctx)
            return `${q}${computed ?? p}${q}`
          } catch {
            return `${q}${p}${q}`
          }
        }
      )
      try {
        if (isLikelyApiContextAt(source, offset)) {
          const re = /(['"])(.*?)(\1)/g
          let match: RegExpExecArray | null
          while ((match = re.exec(inner))) {
            const raw = match[2]
            const resolved = resolveLiteralToOutput(
              normalizeLiteralPayload(raw),
              {
                manifestPath: ctx.manifestPath,
                packageJsonDir: ctx.packageJsonDir,
                authorFilePath: ctx.authorFilePath
              }
            )
            ctx.onResolvedLiteral?.(
              raw,
              resolved ?? undefined,
              offset + match.index
            )
          }
        }
      } catch {
        // best-effort only
      }

      return `${pre}${replacedInner}${post}`
    } catch {
      return full
    }
  }
  return input.replace(rx, onMatch as any)
}

export function replaceJsCssArrays(
  source: string,
  input: string,
  ctx: TextTransformContext
): string {
  for (const key of ['js', 'css']) {
    const rxArr = new RegExp(`(${key}\\s*:\\s*\\[)([^\\]]*)(\\])`, 'g')
    function onMatch(
      full: string,
      pre: string,
      inner: string,
      post: string,
      offset: number
    ) {
      try {
        const replacedInner = String(inner).replace(
          /(['"])(.*?)(\1)/g,
          function onLiteral(_m: string, q: string, p: string) {
            try {
              const computed = resolveAndNormalizeLiteral(p, ctx)
              return `${q}${computed ?? p}${q}`
            } catch {
              return `${q}${p}${q}`
            }
          }
        )
        try {
          if (isLikelyApiContextAt(source, offset)) {
            const re = /(['"])(.*?)(\1)/g
            let match: RegExpExecArray | null
            while ((match = re.exec(inner))) {
              const raw = match[2]
              const resolved = resolveLiteralToOutput(
                normalizeLiteralPayload(raw),
                {
                  manifestPath: ctx.manifestPath,
                  packageJsonDir: ctx.packageJsonDir,
                  authorFilePath: ctx.authorFilePath
                }
              )
              ctx.onResolvedLiteral?.(
                raw,
                resolved ?? undefined,
                offset + match.index
              )
            }
          }
        } catch {
          // best-effort only
        }

        return `${pre}${replacedInner}${post}`
      } catch {
        return full
      }
    }

    input = input.replace(rxArr, onMatch as any)
  }
  return input
}
