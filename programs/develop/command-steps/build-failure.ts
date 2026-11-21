// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {codedError} from '../lib/coded-error'
import * as messages from '../lib/messages'
import {CODES, stripChannelPrefix} from '../lib/messaging'
import {displayPath} from '../lib/paths'
import {thrownFrom} from '../lib/thrown-location'
import type {createReadyContractWriter} from '../plugin-ready-contract'

// Failures the compile already reported, line by line and with their count.
export const reportedBuildFailures = new WeakSet<object>()

// Failures whose own lines are on stderr already, the closing count aside.
export const printedBuildFailures = new WeakSet<object>()

export function readableFailure(thrown: unknown, projectRoot: string): Error {
  try {
    if (thrown instanceof Error && typeof thrown.message === 'string') {
      if (thrown.message.trim()) return thrown

      // An empty message prints as the bare word Error, so the place it was
      // thrown from stands in for it and the declared code is kept.
      return Object.assign(
        new Error(
          messages.errorWithoutMessageText(thrownFrom(thrown, projectRoot))
        ),
        {cause: thrown},
        hasDeclaredCode(thrown) ? {code: (thrown as {code?: unknown}).code} : {}
      )
    }
  } catch {
    // Ignore
  }

  return Object.assign(new Error(messages.thrownValueText(thrown)), {
    cause: thrown
  })
}

const WRITE_REFUSALS: Record<string, string> = {
  EACCES: 'permission denied',
  EPERM: 'operation not permitted',
  EROFS: 'read-only file system'
}

// The bundler reports a folder it may not write to as its own fatal error.
// It is the output folder's state, so it is named as that, with the folder.
export function outputNotWritable(thrown: unknown, outputRoot: string) {
  const text = thrown instanceof Error ? thrown.message : String(thrown)
  const code = Object.keys(WRITE_REFUSALS).find((name) => text.includes(name))

  if (!code || !text.includes(outputRoot)) return undefined

  return Object.assign(
    codedError(
      CODES.E_OUTPUT_NOT_WRITABLE,
      messages.buildOutputFolderNotWritable(
        displayPath(outputRoot),
        `${code}: ${WRITE_REFUSALS[code]}`
      )
    ),
    {cause: thrown}
  )
}

// A throw from a plugin or from the bundler itself, with no compile error
// behind it. A code the thrower declared is the answer it meant.
export function fatalFailure(thrown: unknown, projectRoot: string): Error {
  const failure = readableFailure(thrown, projectRoot)

  if (hasDeclaredCode(failure)) return failure

  return Object.assign(codedError(CODES.E_COMPILE_FATAL, failure.message), {
    cause: thrown
  })
}

// The id stays build_failed. A code the failure declared is stamped beside
// it, which a reader takes before the id's E_COMPILE fallback.
export function writeFailedReceipt(
  writer: ReturnType<typeof createReadyContractWriter>,
  error: unknown
): void {
  const message = stripChannelPrefix(
    error instanceof Error ? error.message : String(error)
  )

  writer.writeError('build_failed', message)

  if (hasDeclaredCode(error)) {
    writer.writeEndedAsFailed(String((error as {code: string}).code), message)
  }
}

function hasDeclaredCode(error: unknown): boolean {
  const code = (error as {code?: unknown} | null)?.code

  return (
    typeof code === 'string' &&
    Object.prototype.hasOwnProperty.call(CODES, code)
  )
}

// A compiler left open keeps its watchers and cache handles in the host.
export async function closeCompiler(
  compiler: {close?: (done: () => void) => void} | undefined
): Promise<void> {
  if (typeof compiler?.close !== 'function') return

  try {
    await new Promise<void>((resolve) => compiler.close?.(() => resolve()))
  } catch {
    // Ignore
  }
}
