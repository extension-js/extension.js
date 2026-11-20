// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import stylistic from '@stylistic/eslint-plugin'

const BANNER_ART = /[█╔╗╚╝║]/
const DECORATION_ONLY = /^\s*[-─━═=~*#]{3,}\s*$/
const DASH_WRAPPED_TITLE = /^\s*-{2,}\s+(.*?)\s+-{2,}\s*$/
const BOX_RULE = /[─━═]{3,}/
const BOX_EDGES = /^[\s─━═]+|[\s─━═]+$/g

// Comments read by a tool (linters, compilers, bundlers, coverage, test
// runners) or carrying a license notice. The comment rules never touch them.
const FUNCTIONAL_COMMENT = [
  /^\s*(eslint|eslint-disable|eslint-enable|global|globals|exported)\b/,
  /^\s*@ts-/,
  /^\/\s*<(reference|amd-module)\b/,
  /^\s*[#@] sourceMappingURL=/,
  /[@#]__(PURE|NO_SIDE_EFFECTS)__/,
  /@(vitest|jest)-environment\b/,
  /\bwebpack(ChunkName|Ignore|Mode|Prefetch|Preload|Include|Exclude|Exports|FetchPriority)\b/,
  /@vite-ignore\b/,
  /^!/,
  /@(license|preserve)\b/,
  /@jsx(ImportSource|Frag|Runtime)?\b/,
  /\bprettier-ignore\b/,
  /\bbiome-ignore(-all|-start|-end)?\b/,
  /\b(c8|istanbul|v8) ignore\b/
]

const LICENSE_NOTICE =
  /\b(MIT|Apache|BSD|ISC|MPL|L?GPL)\b.*\bLicen[cs]e\b|\b(Licensed|Released) under\b|\bCopyright\b|\(c\)\s*\d{4}|SPDX-License-Identifier/i

/** @typedef {ReturnType<import('eslint').SourceCode['getAllComments']>[number]} Comment */
/** @typedef {import('eslint').AST.SourceLocation} SourceLocation */
/** @typedef {Comment & {loc: SourceLocation, range: [number, number]}} LocatedComment */
/** @typedef {import('eslint').SourceCode} SourceCode */
/** @typedef {import('eslint').Rule.RuleFixer} RuleFixer */
/** @typedef {import('eslint').Rule.RuleContext} RuleContext */
/** @typedef {import('eslint').Rule.RuleModule} RuleModule */
/** @typedef {{raw: string, text: string, isTag: boolean}} JsdocLine */

/** @type {import('eslint').Rule.RuleMetaData['schema']} */
const bannerOption = [
  {
    type: 'object',
    properties: {allowBanner: {type: 'boolean'}},
    additionalProperties: false
  }
]

// ESLint types loc and range as optional on a comment, and a comment without
// both cannot be reported or fixed, so every rule reads only located ones.
/**
 * @param {Comment} comment
 * @returns {comment is LocatedComment}
 */
function isLocated(comment) {
  return Boolean(comment.loc && comment.range)
}

/**
 * @param {SourceCode} sourceCode
 * @returns {LocatedComment[]}
 */
function locatedComments(sourceCode) {
  return sourceCode.getAllComments().filter(isLocated)
}

/** @param {Comment} comment */
function isFunctionalComment(comment) {
  return (
    LICENSE_NOTICE.test(comment.value) ||
    FUNCTIONAL_COMMENT.some((pattern) => pattern.test(comment.value))
  )
}

// A license notice keeps the attribution lines written against it.
/**
 * @param {LocatedComment[]} comments
 * @returns {Set<LocatedComment>}
 */
function licenseGroups(comments) {
  /** @type {Set<LocatedComment>} */
  const kept = new Set()
  /** @type {LocatedComment[]} */
  let group = []

  const flush = () => {
    if (group.some((comment) => LICENSE_NOTICE.test(comment.value))) {
      for (const comment of group) kept.add(comment)
    }

    group = []
  }

  for (const comment of comments) {
    const previous = group.at(-1)

    if (previous && previous.loc.end.line + 1 !== comment.loc.start.line) {
      flush()
    }

    group.push(comment)
  }

  flush()

  return kept
}

/**
 * @param {SourceCode} sourceCode
 * @param {LocatedComment} comment
 */
function ownsLines(sourceCode, comment) {
  const before = (sourceCode.lines[comment.loc.start.line - 1] ?? '').slice(
    0,
    comment.loc.start.column
  )
  const after = (sourceCode.lines[comment.loc.end.line - 1] ?? '').slice(
    comment.loc.end.column
  )

  return before.trim() === '' && after.trim() === ''
}

/**
 * @param {SourceCode} sourceCode
 * @param {number} startLine
 * @param {number} endLine
 * @returns {[number, number]}
 */
function lineRange(sourceCode, startLine, endLine) {
  const start = sourceCode.getIndexFromLoc({line: startLine, column: 0})
  const end =
    endLine < sourceCode.lines.length
      ? sourceCode.getIndexFromLoc({line: endLine + 1, column: 0})
      : sourceCode.text.length

  return [start, end]
}

/**
 * @param {RuleFixer} fixer
 * @param {SourceCode} sourceCode
 * @param {LocatedComment} comment
 */
function removeComment(fixer, sourceCode, comment) {
  if (!ownsLines(sourceCode, comment)) return fixer.removeRange(comment.range)

  return fixer.removeRange(
    lineRange(sourceCode, comment.loc.start.line, comment.loc.end.line)
  )
}

/** @param {Comment} comment */
function isTagOnlyJsdoc(comment) {
  return (
    comment.type === 'Block' &&
    comment.value.startsWith('*') &&
    jsdocLines(comment).every((line) => line.text === '' || line.isTag)
  )
}

/**
 * @param {Comment} comment
 * @returns {JsdocLine[]}
 */
function jsdocLines(comment) {
  let inTags = false

  return comment.value
    .slice(1)
    .split('\n')
    .map((raw) => {
      const text = raw.replace(/^\s*\*?\s?/, '').trim()
      if (text.startsWith('@')) inTags = true

      return {raw, text, isTag: inTags && text !== ''}
    })
}

/** @type {RuleModule} */
const blankLineAfterShebang = {
  meta: {type: 'layout', fixable: 'whitespace', schema: []},
  create(context) {
    return {
      Program() {
        const lines = context.sourceCode.lines
        if (!lines[0]?.startsWith('#!') || lines.length < 2) return
        if ((lines[1] ?? '').trim() === '') return

        context.report({
          loc: {line: 1, column: 0},
          message: 'Expected a blank line after the shebang.',
          fix: (fixer) => fixer.insertTextAfterRange([0, lines[0].length], '\n')
        })
      }
    }
  }
}

/** @type {RuleModule} */
const noFileHeaderComment = {
  meta: {type: 'suggestion', fixable: 'code', schema: bannerOption},
  create(context) {
    const allowBanner = context.options[0]?.allowBanner ?? false
    const {sourceCode} = context

    return {
      Program(node) {
        const first = sourceCode.getFirstToken(node)
        if (!first) return

        // ESLint lists a shebang among the comments, typed or not.
        const leading = locatedComments(sourceCode)
          .filter((comment) => String(comment.type) !== 'Shebang')
          .filter((comment) => comment.range[0] < first.range[0])
        const licensed = licenseGroups(leading)

        const header = leading
          .filter((comment) => !licensed.has(comment))
          .filter((comment) => !isFunctionalComment(comment))
          .filter((comment) => !isTagOnlyJsdoc(comment))
          .filter((comment) => !(allowBanner && BANNER_ART.test(comment.value)))

        const firstHeader = header[0]
        const lastHeader = header.at(-1)
        if (!firstHeader || !lastHeader) return

        context.report({
          loc: {start: firstHeader.loc.start, end: lastHeader.loc.end},
          message: 'Remove the file header comment.',
          fix: (fixer) =>
            header.map((comment) => removeComment(fixer, sourceCode, comment))
        })
      }
    }
  }
}

/** @type {RuleModule} */
const noDividerComment = {
  meta: {type: 'suggestion', fixable: 'code', schema: bannerOption},
  create(context) {
    const allowBanner = context.options[0]?.allowBanner ?? false
    const {sourceCode} = context

    return {
      Program() {
        for (const comment of locatedComments(sourceCode)) {
          if (comment.type !== 'Line') continue
          if (isFunctionalComment(comment)) continue
          if (allowBanner && BANNER_ART.test(comment.value)) continue

          const title = DECORATION_ONLY.test(comment.value)
            ? ''
            : (comment.value.match(DASH_WRAPPED_TITLE)?.[1] ??
              (BOX_RULE.test(comment.value)
                ? comment.value.replace(BOX_EDGES, '')
                : null))

          if (title === null) continue

          context.report({
            loc: comment.loc,
            message: 'Remove the section divider comment.',
            fix: (fixer) =>
              title === ''
                ? removeComment(fixer, sourceCode, comment)
                : fixer.replaceText(comment, `// ${title}`)
          })
        }
      }
    }
  }
}

/** @type {RuleModule} */
const noJsdocDescription = {
  meta: {type: 'suggestion', fixable: 'code', schema: []},
  create(context) {
    const {sourceCode} = context

    return {
      Program() {
        for (const comment of locatedComments(sourceCode)) {
          if (comment.type !== 'Block' || !comment.value.startsWith('*')) {
            continue
          }

          if (isFunctionalComment(comment)) continue

          const lines = jsdocLines(comment)
          if (lines.every((line) => line.text === '' || line.isTag)) continue

          const tags = lines.filter((line) => line.isTag)
          const indent = (
            sourceCode.lines[comment.loc.start.line - 1] ?? ''
          ).slice(0, comment.loc.start.column)

          context.report({
            loc: comment.loc,
            message: 'Remove the JSDoc description; keep only type tags.',
            fix: (fixer) =>
              tags.length === 0
                ? removeComment(fixer, sourceCode, comment)
                : fixer.replaceText(
                    comment,
                    `/**\n${tags.map((line) => line.raw.trimEnd()).join('\n')}\n${indent} */`
                  )
          })
        }
      }
    }
  }
}

const basePadding = stylistic.rules['padding-line-between-statements']

// Prettier and Biome start a statement with `;(` or `;[` when semicolons are
// off. That guard shares the line with the statement it protects, so padding
// reports against it are skipped.
/** @type {RuleModule} */
const paddingLineBetweenStatements = {
  meta: basePadding.meta,
  create(context) {
    const {sourceCode} = context

    /** @param {import('eslint').Rule.ReportDescriptor} descriptor */
    const report = (descriptor) => {
      // The padding rule reports against a node, which a descriptor may lack.
      const node =
        'node' in descriptor
          ? /** @type {import('eslint').Rule.Node} */ (descriptor.node)
          : undefined
      const before = node ? sourceCode.getTokenBefore(node) : null
      const asiGuard =
        before?.value === ';' && before.loc.start.line === node?.loc?.start.line

      if (!asiGuard) context.report(descriptor)
    }

    return basePadding.create(Object.create(context, {report: {value: report}}))
  }
}

export default {
  rules: {
    'padding-line-between-statements': paddingLineBetweenStatements,
    'blank-line-after-shebang': blankLineAfterShebang,
    'no-file-header-comment': noFileHeaderComment,
    'no-divider-comment': noDividerComment,
    'no-jsdoc-description': noJsdocDescription
  }
}
