// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import type {Compiler} from '@rspack/core'
import type {Manifest} from '../../types'
import {isGeckoBasedBrowser} from '../constants'
import {parseAuthoredJson} from '../parse-json-safe'

type ParseOptions = {browser?: string; emptyAsObject?: boolean}

interface Held {
  signature: string
  text: string
  parsed: Map<string, unknown>
  reread?: boolean
}

const held = new Map<string, Held>()

// Inode, size and both nanosecond times: a rename over the file, a touch that
// restores the modified time and a same-size edit each change one of them.
function signatureOf(manifestPath: string): string | undefined {
  try {
    const stat = fs.statSync(manifestPath, {bigint: true})

    return `${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`
  } catch {
    return undefined
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)

    for (const child of Object.values(value)) deepFreeze(child)
  }

  return value
}

function holdText(manifestPath: string): Held | undefined {
  const signature = signatureOf(manifestPath)
  const known = held.get(manifestPath)

  if (signature && known?.signature === signature && !known.reread) {
    return known
  }

  held.delete(manifestPath)
  if (!signature) return undefined

  const text = fs.readFileSync(manifestPath, 'utf-8')
  // The same text keeps its parsed objects, so what a reader derived from
  // one of them still stands for a file nobody edited.
  const entry: Held =
    known?.text === text
      ? {signature, text, parsed: known.parsed}
      : {signature, text, parsed: new Map()}
  held.set(manifestPath, entry)

  return entry
}

// The text of a manifest file, read from disk once for each version of the
// file: every reader of one build gets the same text from that one read.
export function readManifestText(manifestPath: string): string {
  // A file that cannot be stat'ed is read directly, so the reader raises
  // the error the file system gives for it.
  return holdText(manifestPath)?.text ?? fs.readFileSync(manifestPath, 'utf-8')
}

// The parsed manifest, one frozen object shared by every reader. A reader
// that changes its manifest parses readManifestText for a copy of its own.
export function readManifest<T = Manifest>(
  manifestPath: string,
  options: ParseOptions = {}
): T {
  const entry = holdText(manifestPath)

  if (!entry) {
    return parseAuthoredJson<T>(fs.readFileSync(manifestPath, 'utf-8'), options)
  }

  // The two options decide whether a text parses at all, never what it
  // parses to, so each pair keeps its own parse and its own error.
  const strictness = `${options.emptyAsObject ? 'empty' : ''}:${
    options.browser && isGeckoBasedBrowser(String(options.browser))
      ? 'gecko'
      : ''
  }`

  if (!entry.parsed.has(strictness)) {
    entry.parsed.set(
      strictness,
      deepFreeze(parseAuthoredJson(entry.text, options))
    )
  }

  return entry.parsed.get(strictness) as T
}

export function forgetManifestReads(): void {
  for (const entry of held.values()) entry.reread = true
}

// A new compilation starts from the file on disk even where the file system
// keeps coarse times and an edit leaves the signature as it was.
export function forgetManifestReadsPerCompilation(compiler: Compiler): void {
  const tap = {name: 'manifest:forget-reads', stage: -1000}

  compiler.hooks.beforeRun.tap(tap, forgetManifestReads)
  compiler.hooks.watchRun.tap(tap, forgetManifestReads)
}
