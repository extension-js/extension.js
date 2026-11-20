import {afterEach} from 'vitest'
import type {BridgeCoordinates} from '../../steps/inject-bridge-producer'

// What a spec says its dev session listens on, handed to the plugin the way
// the session's own config hands it. Each test starts with no session.
let bridge: BridgeCoordinates = {}

afterEach(() => {
  bridge = {}
})

export function setSessionBridge(part: BridgeCoordinates): void {
  bridge = {...bridge, ...part}
}

export function sessionBridge(): BridgeCoordinates {
  return {...bridge}
}

// A port as a command line or a config file would spell it.
export function portOf(value: unknown): number | null {
  const port = Number.parseInt(String(value ?? ''), 10)

  return Number.isFinite(port) ? port : null
}
