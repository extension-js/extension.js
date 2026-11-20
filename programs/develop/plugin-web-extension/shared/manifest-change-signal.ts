// ███████╗██╗  ██╗ █████╗ ██████╗ ███████╗██████╗
// ██╔════╝██║  ██║██╔══██╗██╔══██╗██╔════╝██╔══██╗
// ███████╗███████║███████║██████╔╝█████╗  ██║  ██║
// ╚════██║██╔══██║██╔══██║██╔══██╗██╔══╝  ██║  ██║
// ███████║██║  ██║██║  ██║██║  ██║███████╗██████╔╝
// ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {Compiler} from '@rspack/core'

// A manifest field whose entries changed in a way one compiler cannot take
// in: an entry was added, removed, moved or put under another key.
export interface ManifestChange {
  reason: 'scripts' | 'html' | 'icons' | 'json'
  pathAfter?: string
  pathBefore?: string
  pathChanged?: string
  manifestField?: string
  manifestFieldBefore?: string
}

// Answers true when the listener carries the change, so no error is owed.
export type ManifestChangeListener = (change: ManifestChange) => boolean

const listeners = new WeakMap<Compiler, ManifestChangeListener>()

// Whoever runs the session listens. A build with no session has no listener.
export function listenForManifestChange(
  compiler: Compiler,
  listener: ManifestChangeListener
): void {
  listeners.set(compiler, listener)
}

export function signalManifestChange(
  compiler: Compiler,
  change: ManifestChange
): boolean {
  return listeners.get(compiler)?.(change) ?? false
}
