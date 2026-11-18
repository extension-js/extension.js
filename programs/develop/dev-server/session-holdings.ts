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
  // Runs at process exit and at a release, whichever comes first.
  add: (release: Release) => void
  // Runs at a release only: the process exit needs it in place, as it does
  // the listener that writes the last frame.
  addForRelease: (release: Release) => void
  releaseAll: () => void
}

// What one dev session registered in its host: listeners, timers, open
// files. One exit listener covers all of it, so sessions do not stack them.
export function createSessionHoldings(
  events: ExitEvents = process
): SessionHoldings {
  const atExit: Release[] = []
  const atRelease: Release[] = []
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
    run(atExit)
  }

  events.once('exit', onExit)

  return {
    add: (release) => {
      atExit.push(release)
    },
    addForRelease: (release) => {
      atRelease.push(release)
    },
    releaseAll: () => {
      if (done) return

      done = true
      events.removeListener('exit', onExit)
      run(atRelease)
      run(atExit)
    }
  }
}
