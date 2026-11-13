// ██╗    ██╗███████╗██████╗       ██████╗ ███████╗███████╗ ██████╗ ██╗   ██╗██████╗  ██████╗███████╗███████╗
// ██║    ██║██╔════╝██╔══██╗      ██╔══██╗██╔════╝██╔════╝██╔═══██╗██║   ██║██╔══██╗██╔════╝██╔════╝██╔════╝
// ██║ █╗ ██║█████╗  ██████╔╝█████╗██████╔╝█████╗  ███████╗██║   ██║██║   ██║██████╔╝██║     █████╗  ███████╗
// ██║███╗██║██╔══╝  ██╔══██╗╚════╝██╔══██╗██╔══╝  ╚════██║██║   ██║██║   ██║██╔══██╗██║     ██╔══╝  ╚════██║
// ╚███╔███╔╝███████╗██████╔╝      ██║  ██║███████╗███████║╚██████╔╝╚██████╔╝██║  ██║╚██████╗███████╗███████║
//  ╚══╝╚══╝ ╚══════╝╚═════╝       ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═╝ ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {
  blankComments,
  escapeRegExp
} from '../../feature-scripts/steps/source-literals'
import {
  collectGetUrlLiterals,
  MAX_SCANNED_SOURCE_BYTES
} from './unreachable-resources'

const IDENTIFIER = '[A-Za-z_$][\\w$]*'

// What a page-context bundle says about the extension pages it mentions: a
// page it merely names, and a page it turns into a URL a web page can load.
export interface PageRequestScan {
  names: (page: string) => boolean
  requests: (page: string) => boolean
}

function reachesGetUrl(parameter: string, body: string): boolean {
  return new RegExp(`getURL\\s*\\(\\s*${escapeRegExp(parameter)}\\s*[,)]`).test(
    body
  )
}

// A helper is a function whose first parameter goes straight to getURL, the
// one wrapper shape that can be followed without evaluating the bundle.
function getUrlHelperNames(code: string): string[] {
  const names = new Set<string>()
  const declared = new RegExp(
    `function\\s+(${IDENTIFIER})\\s*\\(\\s*(${IDENTIFIER})[^)]*\\)\\s*\\{([^{}]*)\\}`,
    'g'
  )

  for (const match of code.matchAll(declared)) {
    if (reachesGetUrl(match[2], match[3])) names.add(match[1])
  }

  const assigned = new RegExp(
    `(${IDENTIFIER})\\s*[=:]\\s*(?:function\\s*)?(?:\\(\\s*(${IDENTIFIER})[^)]*\\)|(${IDENTIFIER}))\\s*(?:=>)?\\s*(\\{[^{}]*\\}|[^\\n;{]*)`,
    'g'
  )

  for (const match of code.matchAll(assigned)) {
    if (reachesGetUrl(match[2] || match[3], match[4])) names.add(match[1])
  }

  return [...names]
}

export function scanPageRequests(source: string): PageRequestScan {
  // Past the scan budget nothing can be told apart, so a named page stays
  // exposed, the rule every build before this one shipped with.
  if (source.length > MAX_SCANNED_SOURCE_BYTES) {
    return {
      names: (page) => source.includes(page),
      requests: (page) => source.includes(page)
    }
  }

  // A commented-out call asks for nothing, so comments go before any scan.
  const code = blankComments(source)
  let literals: Set<string> | undefined
  let helpers: string[] | undefined

  const requests = (page: string) => {
    literals ??= new Set(collectGetUrlLiterals(code))
    if (literals.has(page)) return true

    const path = `\\/?${escapeRegExp(page)}`
    const quoted = `["'\`]${path}["'\`]`
    const constants = Array.from(
      code.matchAll(
        new RegExp(
          `(?:const|let|var)\\s+(${IDENTIFIER})\\s*=\\s*${quoted}`,
          'g'
        )
      ),
      (match) => escapeRegExp(match[1])
    )

    helpers ??= getUrlHelperNames(code)

    const callees = ['getURL', ...helpers.map(escapeRegExp)].join('|')
    const argument = [quoted, ...constants].join('|')

    if (
      new RegExp(
        `(?<![\\w$])(?:${callees})\\s*\\(\\s*(?:${argument})\\s*[,)]`
      ).test(code)
    ) {
      return true
    }

    // The extension origin or its id joined with the path, in one template
    // or one concatenation, is the same URL getURL would have answered.
    return new RegExp(
      `(?:runtime\\s*\\??\\.\\s*id\\b|-extension:\\/\\/)[^;,\\n]{0,120}?\\/${escapeRegExp(page)}(?![\\w/.-])|getURL\\s*\\([^)]*\\)\\s*\\+\\s*["'\`]${path}["'\`]`
    ).test(code)
  }

  return {names: (page) => code.includes(page), requests}
}
