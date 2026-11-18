//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as os from 'node:os'

// Where an unclassified failure was thrown, as one word the CLI chose. A
// function name read off a stack would carry the layout of someone's machine.
export const FAILURE_STEPS = [
  // The command's own code, reached by the entry point's catch.
  'action',
  // Loading the build engine module, before any project is read.
  'engine_load',
  // The build engine running the command.
  'engine',
  // The scaffolder that creates a project.
  'scaffold'
] as const

export type FailureStep = (typeof FAILURE_STEPS)[number]

const STEPS: ReadonlySet<string> = new Set(FAILURE_STEPS)

const BUILT_IN_ERRORS: ReadonlySet<string> = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'SyntaxError',
  'ReferenceError',
  'EvalError',
  'URIError',
  'AggregateError'
])

// Node's system codes: the errno table of this platform, the libuv codes it
// leaves out, and the code a failed require carries.
const SYSTEM_CODES: ReadonlySet<string> = new Set([
  ...Object.keys(os.constants.errno),
  'EAI_AGAIN',
  'EAI_NONAME',
  'EAI_FAIL',
  'ECHARSET',
  'EFTYPE',
  'MODULE_NOT_FOUND'
])

// Node's own error codes share one shape, which leaves no room for a message.
const NODE_ERROR_CODE = /^ERR_[A-Z][A-Z0-9_]{1,62}$/

export const OTHER_ERROR_CLASS = 'other'

function systemCode(error: object): string | undefined {
  const code = (error as {code?: unknown}).code
  if (typeof code !== 'string') return undefined

  return SYSTEM_CODES.has(code) || NODE_ERROR_CODE.test(code) ? code : undefined
}

// A system code when the error has one, else a built-in class name, else
// `other`. A custom or renamed class is `other`, since its name is ours or
// a dependency's free text.
export function telemetryErrorClass(error: unknown): string {
  if (!error || typeof error !== 'object') return OTHER_ERROR_CLASS

  const code = systemCode(error)
  if (code) return code

  const constructorName = (error as {constructor?: {name?: unknown}})
    .constructor?.name
  const name = (error as {name?: unknown}).name

  if (
    typeof constructorName === 'string' &&
    BUILT_IN_ERRORS.has(constructorName) &&
    name === constructorName
  ) {
    return constructorName
  }

  return OTHER_ERROR_CLASS
}

export function isTelemetryErrorClass(value: unknown): value is string {
  if (typeof value !== 'string') return false

  return (
    value === OTHER_ERROR_CLASS ||
    BUILT_IN_ERRORS.has(value) ||
    SYSTEM_CODES.has(value) ||
    NODE_ERROR_CODE.test(value)
  )
}

export function isFailureStep(value: unknown): value is FailureStep {
  return typeof value === 'string' && STEPS.has(value)
}
