//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

interface Round {
  said: Set<string>
  saidBefore: ReadonlySet<string>
}

const rounds = new Map<string, Round>()

// One compiler builds a style rule per file type and per place a sheet can
// load, and each rule reads the same config, so a finding is said once.
export function beginStyleDiagnostics(projectPath: string, mode: string) {
  // A dev session that opens a new compiler repeats a finding only when it
  // went away in between, while every build says what it found.
  const earlier = mode === 'development' ? rounds.get(projectPath) : undefined

  rounds.set(projectPath, {
    said: new Set(),
    saidBefore: earlier?.said ?? new Set()
  })
}

export function reportStyleDiagnostic(
  projectPath: string,
  message: string,
  print: (message: string) => void = console.warn
) {
  const round = rounds.get(projectPath)

  // A caller outside a compiler asked once, so it hears every answer.
  if (!round) {
    print(message)

    return
  }

  if (round.said.has(message)) return

  round.said.add(message)

  if (!round.saidBefore.has(message)) print(message)
}
