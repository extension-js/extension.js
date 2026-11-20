// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as path from 'node:path'

interface ParkedHoldings {
  source: string
  root: string
  release: () => void
}

// What a green `start` build keeps for the launch that follows it: the env
// file values and the card, given back by whichever preview leg takes them.
const parked = new Set<ParkedHoldings>()

const sourceKey = (source: string | undefined) => String(source ?? '')

export function parkForStartLaunch(
  source: string | undefined,
  projectRoot: string,
  release: () => void
): void {
  parked.add({
    source: sourceKey(source),
    root: path.resolve(projectRoot),
    release
  })
}

// A leg that knows its project takes what was parked for that folder. One
// that failed before it knew takes what was parked for the path it was given.
export function takeStartLaunchHoldings(
  source: string | undefined,
  projectRoot?: string
): Array<() => void> {
  const root = projectRoot ? path.resolve(projectRoot) : undefined
  const taken = [...parked].filter((entry) =>
    root ? entry.root === root : entry.source === sourceKey(source)
  )

  for (const entry of taken) parked.delete(entry)

  return taken.map((entry) => entry.release)
}
