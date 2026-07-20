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

export function stubProcessExit() {
  return vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new ExitSignal(code ?? 0)
  }) as never)
}

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
