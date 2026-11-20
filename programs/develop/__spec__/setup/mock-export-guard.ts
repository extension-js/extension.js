import {afterAll, afterEach} from 'vitest'

// A module mock that leaves out an export throws when code reads it. Code
// that catches the throw then runs its failure branch and the spec passes.
const MISSING_EXPORT = /No "[^"]*" export is defined on the "[^"]*" mock/

interface VitestMocker {
  createError?: (message: string, codeFrame?: string) => Error
  guardedForMissingExports?: boolean
}

const mocker = (globalThis as {__vitest_mocker__?: VitestMocker})
  .__vitest_mocker__
const missing: string[] = []

if (!mocker || typeof mocker.createError !== 'function') {
  throw new Error(
    'The mock export guard cannot see how vitest reports a missing mock export, so a swallowed one would pass unseen. Update __spec__/setup/mock-export-guard.ts for this vitest version.'
  )
}

if (!mocker.guardedForMissingExports) {
  const createError = mocker.createError.bind(mocker)

  mocker.createError = (message, codeFrame) => {
    const text = String(message)

    if (MISSING_EXPORT.test(text)) missing.push(text.split('\n')[0])

    return createError(message, codeFrame)
  }

  mocker.guardedForMissingExports = true
}

// Hands over what was read since the last look, and forgets it.
export function takeMissingMockExports(): string[] {
  return [...new Set(missing.splice(0))]
}

function failOnMissingExports() {
  const seen = takeMissingMockExports()

  if (seen.length === 0) return

  throw new Error(
    `Code under test read an export its module mock does not define:\n${seen
      .map((line) => `  ${line}`)
      .join(
        '\n'
      )}\nSpread the real module in the mock factory and override only what the spec fakes.`
  )
}

afterEach(failOnMissingExports)
afterAll(failOnMissingExports)
