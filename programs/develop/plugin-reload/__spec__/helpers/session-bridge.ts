import {afterEach} from 'vitest'
import {sessionOf} from '../../../__spec__/helpers/dev-session'
import type {DevSessionCoordinates} from '../../../lib/dev-session-coordinates'

// What a spec says its dev session listens on, handed to the plugin the way
// the session's own config hands it. Each test starts with no session.
let bridge: Partial<DevSessionCoordinates> | undefined

afterEach(() => {
  bridge = undefined
})

export function setSessionBridge(part: Partial<DevSessionCoordinates>): void {
  bridge = {...bridge, ...part}
}

// The record of the session a spec named, or none when it named nothing.
export function sessionBridge(): Readonly<DevSessionCoordinates> | undefined {
  return bridge ? sessionOf(bridge) : undefined
}

// A port as a command line or a config file would spell it.
export function portOf(value: unknown): number | null {
  const port = Number.parseInt(String(value ?? ''), 10)

  return Number.isFinite(port) ? port : null
}
