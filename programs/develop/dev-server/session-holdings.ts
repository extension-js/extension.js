// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

type Release = () => void

type ExitEvents = Pick<NodeJS.EventEmitter, 'once' | 'removeListener'>

export interface SessionHoldings {
  // What could still act for the session: a restart, a poller. Runs at
  // process exit, and first at a release.
  addEarly: (release: Release) => void
  // Runs first at a release and never at process exit, which needs it in
  // place, as it does the handlers that run the shutdown.
  addForRelease: (release: Release) => void
  // What the teardown still writes to: a log file. Runs at process exit,
  // and last at a release.
  add: (release: Release) => void
  // Before the server stops.
  beginRelease: () => void
  // After the server, the bridge and the port are gone.
  releaseAll: () => void
}

// What one dev session registered in its host: listeners, timers, open
// files. One exit listener here covers all of it, beside the one the
// lifecycle stream keeps for its last frame, so sessions do not stack them.
export function createSessionHoldings(
  events: ExitEvents = process
): SessionHoldings {
  const early: Release[] = []
  const atRelease: Release[] = []
  const late: Release[] = []
  let done = false

  const run = (releases: Release[]) => {
    for (const release of releases.splice(0).reverse()) {
      try {
        release()
      } catch {
        // Ignore
      }
    }
  }

  const onExit = () => {
    if (done) return

    done = true
    run(early)
    run(late)
  }

  events.once('exit', onExit)

  return {
    addEarly: (release) => {
      early.push(release)
    },
    addForRelease: (release) => {
      atRelease.push(release)
    },
    add: (release) => {
      late.push(release)
    },
    beginRelease: () => {
      if (done) return

      run(atRelease)
      run(early)
    },
    releaseAll: () => {
      if (done) return

      done = true
      events.removeListener('exit', onExit)
      run(atRelease)
      run(early)
      run(late)
    }
  }
}
