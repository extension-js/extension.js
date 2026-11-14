import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {Command} from 'commander'
import {afterAll, beforeAll, vi} from 'vitest'

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

const LOST_SCAFFOLDER_MOCK =
  'extension create reached the real extension-create, not the mock this spec registers. ' +
  'No test in this file ran. A cached transform with a stale resolved import is the usual cause: ' +
  'run `npx vitest --clearCache` and try again.'

// The real scaffolder refuses a URL as the project name before it writes or
// connects, so this probe is safe against it. The mock only records the call.
async function assertTheCommandReachesTheMock(
  register: (program: Command) => void,
  scaffolder: unknown
) {
  const probe = 'https://lost-mock.invalid/probe'
  const savedRoot = process.env.EXTENSION_CREATE_DEVELOP_ROOT
  const exit = stubProcessExit()
  let failure: unknown

  try {
    await runCli(makeProgram(register), ['create', probe])
  } catch (error) {
    failure = error
  }

  const reached =
    vi.isMockFunction(scaffolder) &&
    scaffolder.mock.calls.some(([name]) => name === probe)

  exit.mockRestore()
  vi.clearAllMocks()

  if (savedRoot === undefined) delete process.env.EXTENSION_CREATE_DEVELOP_ROOT
  else process.env.EXTENSION_CREATE_DEVELOP_ROOT = savedRoot

  if (!reached) {
    throw Object.assign(new Error(LOST_SCAFFOLDER_MOCK), {cause: failure})
  }
}

// A lost mock scaffolds a project under the working directory, so the file
// runs in a folder it owns and removes, and stops before its first test.
export function keepTheScaffolderMocked(
  register: (program: Command) => void,
  scaffolder: unknown
) {
  const savedCwd = process.cwd()
  let scratch = ''

  beforeAll(async () => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-create-spec-'))
    process.chdir(scratch)
    await assertTheCommandReachesTheMock(register, scaffolder)
  })

  afterAll(() => {
    process.chdir(savedCwd)
    if (scratch) fs.rmSync(scratch, {recursive: true, force: true})
  })
}
