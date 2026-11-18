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

// Node's own codes a failed load or a bad call carries. A code outside this
// list could be a dependency's free text, so it is not sent.
const NODE_ERROR_CODES: ReadonlySet<string> = new Set([
  'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
  'ERR_DLOPEN_FAILED',
  'ERR_INTERNAL_ASSERTION',
  'ERR_INVALID_ARG_TYPE',
  'ERR_INVALID_ARG_VALUE',
  'ERR_INVALID_MODULE_SPECIFIER',
  'ERR_INVALID_PACKAGE_CONFIG',
  'ERR_INVALID_URL',
  'ERR_MODULE_NOT_FOUND',
  'ERR_OUT_OF_RANGE',
  'ERR_PACKAGE_IMPORT_NOT_DEFINED',
  'ERR_PACKAGE_PATH_NOT_EXPORTED',
  'ERR_REQUIRE_ASYNC_MODULE',
  'ERR_REQUIRE_ESM',
  'ERR_STREAM_PREMATURE_CLOSE',
  'ERR_UNKNOWN_FILE_EXTENSION',
  'ERR_UNSUPPORTED_DIR_IMPORT',
  'ERR_UNSUPPORTED_ESM_URL_SCHEME',
  'ERR_WORKER_OUT_OF_MEMORY'
])

export const OTHER_ERROR_CLASS = 'other'

function systemCode(error: object): string | undefined {
  const code = (error as {code?: unknown}).code
  if (typeof code !== 'string') return undefined

  return SYSTEM_CODES.has(code) || NODE_ERROR_CODES.has(code) ? code : undefined
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
    NODE_ERROR_CODES.has(value)
  )
}

export function isFailureStep(value: unknown): value is FailureStep {
  return typeof value === 'string' && STEPS.has(value)
}
