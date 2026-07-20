// Shared driver for command specs: registers a command on a fresh commander
// program, stubs process.exit so actions can be exercised in-process, and
// translates an exit into its numeric code.

import {Command} from 'commander'
import {vi} from 'vitest'

export class ExitSignal extends Error {
  constructor(readonly code: number) {
    super(`process.exit(${code})`)
  }
}

export function makeProgram(register: (program: Command) => void): Command {
  const program = new Command()
  program.exitOverride()
  register(program)
  return program
}

/** Stub process.exit to throw an ExitSignal instead of killing the runner. */
export function stubProcessExit() {
  return vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new ExitSignal(code ?? 0)
  }) as never)
}

/**
 * Parse user argv and return the exit code: 0 when the action returned
 * normally, otherwise the code passed to the stubbed process.exit.
 */
export async function runCli(
  program: Command,
  argv: string[]
): Promise<number> {
  try {
    await program.parseAsync(argv, {from: 'user'})
    return 0
  } catch (err) {
    if (err instanceof ExitSignal) return err.code
    throw err
  }
}
