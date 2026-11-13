// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {createRequire} from 'node:module'
import * as path from 'node:path'

const requireModule = createRequire(import.meta.url)

export const COMPLETION_VALUE_SETTER = '__extjsCompletion'
export const COMPLETION_VALUE_HOLDER = '__extjsCompletionValue'
const KEEP = '__extjsKeep'

// The browser hands executeScript the value a file's last statement left.
// A bundle hides it in a function, so the file's own block carries it out.
const BLOCK_OPEN = `{let ${COMPLETION_VALUE_HOLDER};const ${COMPLETION_VALUE_SETTER}=function(value){${COMPLETION_VALUE_HOLDER}=value};\n`
// A value the browser cannot clone made Firefox reject the whole call, so
// the file ends on nothing then, the way every bundle did before.
const CLONABLE =
  'function(value){' +
  'var kept=function(value){try{if(typeof structuredClone==="function")structuredClone(value)}catch(error){return}return value};' +
  'try{if(value&&typeof value.then==="function")return Promise.resolve(value).then(kept)}catch(error){}' +
  'return kept(value)}'
const BLOCK_CLOSE = `\n;(${CLONABLE})(${COMPLETION_VALUE_HOLDER})}`
// A module that lands in a file with no such block keeps running as it did.
const KEEP_DECLARATION = `var ${KEEP} = typeof ${COMPLETION_VALUE_SETTER} === "function" ? ${COMPLETION_VALUE_SETTER} : function () {};`

interface Statement {
  type: string
  start: number
  end: number
  directive?: string
  body?: Statement | Statement[] | {body: Statement[]}
  consequent?: Statement | Statement[]
  alternate?: Statement | null
  block?: {body: Statement[]}
  handler?: {body: {start: number; body: Statement[]}} | null
  cases?: Array<{consequent: Statement[]}>
}

interface Edit {
  start: number
  end: number
  text: string
}

const REPEATING = new Set([
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'WhileStatement',
  'DoWhileStatement',
  'SwitchStatement',
  'LabeledStatement',
  'WithStatement'
])

function parseStatements(
  source: string,
  resourcePath: string
): Statement[] | null {
  const extension = path.extname(resourcePath).toLowerCase()
  const typed = /^\.m?tsx?$/.test(extension)

  if (!typed && !/^\.m?jsx$/.test(extension)) {
    const base = {ecmaVersion: 'latest', allowHashBang: true}

    for (const options of [
      {...base, sourceType: 'module'},
      {...base, sourceType: 'script', allowAwaitOutsideFunction: true}
    ]) {
      try {
        return requireModule('acorn').parse(source, options).body
      } catch {
        // The next reading, then the one that knows JSX.
      }
    }
  }

  try {
    const plugins = [
      ...(typed ? ['typescript'] : []),
      ...(/^\.m?ts$/.test(extension) ? [] : ['jsx'])
    ]

    return requireModule('@babel/core').parseSync(source, {
      babelrc: false,
      configFile: false,
      sourceType: 'unambiguous',
      parserOpts: {plugins}
    }).program.body
  } catch {
    // A file no parser reads is the build's own error to report.
    return null
  }
}

function listOf(statements: unknown): Statement[] {
  return Array.isArray(statements) ? (statements as Statement[]) : []
}

function collectEdits(source: string, program: Statement[]): Edit[] {
  const edits: Edit[] = []

  const keep = (statement: Statement) => {
    const text = source.slice(statement.start, statement.end).replace(/;$/, '')

    edits.push({
      start: statement.start,
      end: statement.end,
      text: `${KEEP}((${text}));`
    })
  }

  // A statement that ran and left nothing still replaces an earlier value.
  const forget = (statement: Statement, listed: boolean) => {
    edits.push({
      start: statement.start,
      end: statement.start,
      text: listed ? `${KEEP}();` : `{${KEEP}();`
    })

    if (!listed) {
      edits.push({start: statement.end, end: statement.end, text: '}'})
    }
  }

  // A catch block that leaves nothing drops what its try block left.
  const caught = (handler: NonNullable<Statement['handler']>) => {
    const at = handler.body.start + 1

    edits.push({start: at, end: at, text: `${KEEP}();`})
  }

  const isValue = (statement: Statement) =>
    statement.type === 'ExpressionStatement' && !statement.directive

  // Inside a loop any statement can be the last one to run, so each keeps
  // its value and each compound statement first drops the one before it.
  const every = (statement: Statement, listed: boolean, outermost = false) => {
    if (isValue(statement)) return keep(statement)

    if (statement.type === 'BlockStatement') {
      for (const child of listOf(statement.body)) every(child, true)

      return
    }

    if (statement.type === 'LabeledStatement') {
      const labeled = statement.body as Statement
      const compound =
        REPEATING.has(labeled.type) ||
        labeled.type === 'IfStatement' ||
        labeled.type === 'TryStatement'

      if (!outermost && compound) forget(statement, listed)

      return every(labeled, false, true)
    }

    const compound =
      REPEATING.has(statement.type) ||
      statement.type === 'IfStatement' ||
      statement.type === 'TryStatement'
    if (!compound) return
    if (!outermost) forget(statement, listed)

    if (statement.type === 'IfStatement') {
      every(statement.consequent as Statement, false)
      if (statement.alternate) every(statement.alternate, false)

      return
    }

    if (statement.type === 'TryStatement') {
      for (const child of listOf(statement.block?.body)) every(child, true)

      if (statement.handler) {
        caught(statement.handler)
        for (const child of statement.handler.body.body) every(child, true)
      }

      return
    }

    if (statement.type === 'SwitchStatement') {
      for (const group of statement.cases || []) {
        for (const child of group.consequent) every(child, true)
      }

      return
    }

    every(statement.body as Statement, false)
  }

  // Outside a loop only the last statement that leaves a value counts.
  const last = (statements: Statement[]): boolean => {
    for (let index = statements.length - 1; index >= 0; index--) {
      if (lastOf(statements[index])) return true
    }

    return false
  }

  const lastOf = (statement: Statement): boolean => {
    if (isValue(statement)) {
      keep(statement)

      return true
    }

    if (statement.type === 'BlockStatement') {
      return last(listOf(statement.body))
    }

    if (statement.type === 'IfStatement') {
      lastOf(statement.consequent as Statement)
      if (statement.alternate) lastOf(statement.alternate)

      return true
    }

    if (statement.type === 'TryStatement') {
      last(listOf(statement.block?.body))

      if (statement.handler) {
        caught(statement.handler)
        last(statement.handler.body.body)
      }

      return true
    }

    if (REPEATING.has(statement.type)) {
      every(statement, true, true)

      return true
    }

    return false
  }

  last(program)

  return edits
}

// Rewrites a scripts/ file so the value its last statement leaves reaches
// the block its emitted file ends on. Line count and line starts are kept.
export function keepCompletionValue(
  source: string,
  resourcePath: string,
  options: {importsAnotherScript?: boolean} = {}
): string {
  const program = parseStatements(source, resourcePath)
  if (!program) return source

  const edits = collectEdits(source, program)

  if (edits.length === 0) {
    // An imported scripts/ file ran first and its value is not this file's.
    if (!options.importsAnotherScript) return source

    return `${KEEP_DECLARATION}${source}\n;${KEEP}();`
  }

  let rewritten = source

  for (const edit of edits.sort((a, b) => b.start - a.start || b.end - a.end)) {
    rewritten =
      rewritten.slice(0, edit.start) + edit.text + rewritten.slice(edit.end)
  }

  return `${KEEP_DECLARATION}${rewritten}`
}

export function carriesCompletionValue(text: string): boolean {
  return text.includes(COMPLETION_VALUE_SETTER) && !text.startsWith(BLOCK_OPEN)
}

// The emitted file ends on the value, with its source map comment kept last.
export function closeCompletionValueBlock(text: string): {
  open: string
  closed: string
} {
  const trailer = /\n\/\/# sourceMappingURL=[^\n]*\s*$/.exec(text)
  const body = trailer ? text.slice(0, trailer.index) : text

  return {
    open: BLOCK_OPEN,
    closed: `${body}${BLOCK_CLOSE}${trailer ? trailer[0] : ''}`
  }
}
