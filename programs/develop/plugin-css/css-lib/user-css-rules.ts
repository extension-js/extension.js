//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

const SHEET_EXTENSIONS = ['css', 'scss', 'sass', 'less']

// The build gives a sheet one of these types itself, so setting one changes
// nothing worth a word.
const STYLESHEET_TYPES = new Set(['css', 'css/auto', 'css/global'])

// A test that also takes a made-up extension claims every file, not sheets.
const UNCLAIMED_PROBE = 'extensionjs-unclaimed-probe'

export interface ReplacedRuleType {
  type: string
  extensions: string[]
}

type LooseRule = Record<string, unknown>

function testTakes(test: unknown, file: string): boolean {
  if (test instanceof RegExp) return test.test(file)

  if (typeof test === 'function') {
    try {
      return Boolean(test(file))
    } catch {
      return false
    }
  }

  if (Array.isArray(test)) return test.some((each) => testTakes(each, file))

  return false
}

// The sheet extensions a project rule sets a type for that the build's own
// stylesheet rules replace. A rule tied to a query of its own is left out.
export function replacedStylesheetRuleTypes(
  rules: unknown
): ReplacedRuleType[] {
  const found = new Map<string, Set<string>>()

  const walk = (list: unknown, inheritedTest: unknown, queried: boolean) => {
    if (!Array.isArray(list)) return

    for (const entry of list) {
      if (!entry || typeof entry !== 'object') continue

      const rule = entry as LooseRule
      const test = rule.test ?? rule.resource ?? inheritedTest
      const withQuery = queried || rule.resourceQuery !== undefined
      const type = rule.type

      if (
        typeof type === 'string' &&
        !STYLESHEET_TYPES.has(type) &&
        !withQuery &&
        !testTakes(test, `file.${UNCLAIMED_PROBE}`)
      ) {
        for (const extension of SHEET_EXTENSIONS) {
          if (!testTakes(test, `file.${extension}`)) continue

          const extensions = found.get(type) ?? new Set<string>()

          extensions.add(`.${extension}`)
          found.set(type, extensions)
        }
      }

      walk(rule.oneOf, test, withQuery)
      walk(rule.rules, test, withQuery)
    }
  }

  walk(rules, undefined, false)

  return [...found].map(([type, extensions]) => ({
    type,
    extensions: [...extensions]
  }))
}
