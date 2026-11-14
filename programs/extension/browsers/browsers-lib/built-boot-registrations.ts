// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {humanLine, isDebug} from '../../helpers/messaging'
import type {BootRegistrationsWait} from '../browsers-types'

// A production build carries no dev runtime to report its boot registrations,
// so the launcher asks the running background over the debugger it holds.

const REGISTERS_A_CONTENT_SCRIPT = 'registerContentScripts'

// A background split into chunks names them as plain script paths.
const SCRIPT_PATH = /["'`]([^"'`\n\\]+\.[cm]?js)["'`]/g
const SCRIPT_SRC = /<script\b[^>]*\bsrc\s*=\s*["']?([^"'\s>]+)/gi
const MAX_FILES_READ = 40

// The registry is read once per look, and an answer needs two looks in a
// row that agree, taken once the background has finished starting.
export const BOOT_REGISTRATIONS_LOOK_MS = 25

// A boot registration was seen to answer up to 90 ms after the first line,
// so an empty registry is believed only this long after the background is up.
export const BOOT_REGISTRATIONS_QUIET_MS = 150

export type BackgroundEvaluator = (
  expression: string,
  timeoutMs: number
) => Promise<unknown>

export interface BootRegistrationsAnswer {
  outcome: 'settled' | 'none' | 'timeout'
  count: number
  looks: number
  waitedMs: number
  bootedAfterMs?: number
  ageMs?: number
  // The whole question as the launcher saw it, the debugger's trips included.
  askedForMs?: number
}

function readText(file: string): string | undefined {
  try {
    return fs.readFileSync(file, 'utf-8')
  } catch {
    return undefined
  }
}

function insideOf(root: string, file: string): boolean {
  const relative = path.relative(root, file)

  return (
    Boolean(relative) &&
    !relative.startsWith('..') &&
    !path.isAbsolute(relative)
  )
}

function backgroundEntries(root: string): string[] {
  const manifestText = readText(path.join(root, 'manifest.json'))
  if (!manifestText) return []

  let background: {service_worker?: unknown; scripts?: unknown; page?: unknown}

  try {
    background = JSON.parse(manifestText)?.background || {}
  } catch {
    return []
  }

  const entries: string[] = []

  if (typeof background.service_worker === 'string') {
    entries.push(background.service_worker)
  }

  if (Array.isArray(background.scripts)) {
    for (const script of background.scripts) {
      if (typeof script === 'string') entries.push(script)
    }
  }

  if (typeof background.page === 'string') {
    const page = background.page
    const html = readText(path.join(root, page)) || ''

    for (const match of html.matchAll(SCRIPT_SRC)) {
      const src = match[1].split(/[?#]/)[0]

      entries.push(
        src.startsWith('/') ? src : path.join(path.dirname(page), src)
      )
    }
  }

  return entries.map((entry) => path.resolve(root, entry.replace(/^\/+/, '')))
}

// Read from the files the browser loads, so a folder this CLI never built
// is answered the same way as one it did.
export function builtBackgroundNamesRegistration(distPath: string): boolean {
  if (!distPath) return false

  const root = path.resolve(distPath)
  const queue = backgroundEntries(root)
  const seen = new Set<string>()

  while (queue.length && seen.size < MAX_FILES_READ) {
    const file = queue.shift() as string

    if (seen.has(file) || !insideOf(root, file)) continue

    seen.add(file)

    const source = readText(file)
    if (source === undefined) continue
    if (source.includes(REGISTERS_A_CONTENT_SCRIPT)) return true

    for (const match of source.matchAll(SCRIPT_PATH)) {
      const named = match[1]

      queue.push(
        named.startsWith('/')
          ? path.join(root, named)
          : path.resolve(path.dirname(file), named),
        path.join(root, named)
      )
    }
  }

  return false
}

// Runs inside the background and leaves nothing behind in it. It reads the
// registry the author's own calls fill, and never wraps or delays them.
export function bootRegistrationsProbe(
  timeoutMs: number,
  lookMs: number = BOOT_REGISTRATIONS_LOOK_MS,
  quietMs: number = BOOT_REGISTRATIONS_QUIET_MS
): string {
  return `(async function () {
  var startedAt = Date.now();
  var deadline = startedAt + ${Math.max(0, Math.floor(timeoutMs))};
  var promised = typeof browser !== "undefined" && browser && browser.scripting ? browser.scripting : null;
  var called = typeof chrome !== "undefined" && chrome && chrome.scripting ? chrome.scripting : null;
  var looks = 0;
  var bootedAfterMs;
  function answer(outcome, count) {
    return {outcome: outcome, count: count, looks: looks, waitedMs: Date.now() - startedAt, bootedAfterMs: bootedAfterMs, ageMs: Math.round(age())};
  }
  if (!(promised || called) || typeof (promised || called).getRegisteredContentScripts !== "function") return answer("none", 0);
  function read() {
    if (promised) return promised.getRegisteredContentScripts();
    return new Promise(function (resolve) {
      var returned = called.getRegisteredContentScripts(function (list) {
        void chrome.runtime.lastError;
        resolve(list);
      });
      if (returned && typeof returned.then === "function") returned.then(resolve, function () { resolve([]); });
    });
  }
  function booted() {
    var worker = globalThis.serviceWorker;
    if (worker && typeof worker.state === "string") return worker.state === "activated";
    if (typeof document !== "undefined" && document) return document.readyState === "complete";
    return true;
  }
  function age() {
    try { return performance.now(); } catch (error) { return Date.now() - startedAt; }
  }
  function pause() {
    return new Promise(function (resolve) { setTimeout(resolve, ${Math.max(1, Math.floor(lookMs))}); });
  }
  var before = null;
  var runningSince;
  for (;;) {
    var up = booted();
    if (up && bootedAfterMs === undefined) {
      bootedAfterMs = Date.now() - startedAt;
      runningSince = looks === 0 ? Date.now() - age() : Date.now();
    }
    var list = [];
    try { list = (await read()) || []; } catch (error) { list = []; }
    looks += 1;
    var now = list.map(function (script) { return String(script && script.id); }).sort().join("\\n");
    var agreed = before !== null && before.up && before.ids === now;
    if (up && agreed && list.length) return answer("settled", list.length);
    if (up && agreed && Date.now() - runningSince >= ${Math.max(0, Math.floor(quietMs))}) return answer("none", 0);
    if (Date.now() >= deadline) return answer("timeout", list.length);
    before = {up: up, ids: now};
    await pause();
  }
})()`
}

function readAnswer(raw: unknown): BootRegistrationsAnswer | undefined {
  const answer = raw as Partial<BootRegistrationsAnswer> | undefined

  if (
    !answer ||
    typeof answer !== 'object' ||
    (answer.outcome !== 'settled' &&
      answer.outcome !== 'none' &&
      answer.outcome !== 'timeout')
  ) {
    return undefined
  }

  return {
    outcome: answer.outcome,
    count: Number(answer.count) || 0,
    looks: Number(answer.looks) || 0,
    waitedMs: Number(answer.waitedMs) || 0,
    bootedAfterMs:
      typeof answer.bootedAfterMs === 'number'
        ? answer.bootedAfterMs
        : undefined,
    ageMs: typeof answer.ageMs === 'number' ? answer.ageMs : undefined
  }
}

// An answer that cannot be read is a timeout: the page opens and says so,
// the same as when the dev server hears nothing.
export function backgroundBootRegistrationsWait(
  evaluate: BackgroundEvaluator,
  onAnswer?: (answer: BootRegistrationsAnswer) => void
): BootRegistrationsWait {
  return async (timeoutMs) => {
    const askedAt = Date.now()
    const answer = readAnswer(
      await evaluate(bootRegistrationsProbe(timeoutMs), timeoutMs)
    )

    if (!answer) return 'timeout'

    onAnswer?.({...answer, askedForMs: Date.now() - askedAt})

    return answer.outcome === 'timeout' ? 'timeout' : 'settled'
  }
}

export function debugBootRegistrationsAnswer(answer: BootRegistrationsAnswer) {
  if (!isDebug()) return

  humanLine(
    `[browser] boot registrations: ${answer.outcome}, ${answer.count} registered, ${answer.looks} looks in ${answer.waitedMs}ms, background up after ${answer.bootedAfterMs ?? '?'}ms and ${answer.ageMs ?? '?'}ms old, asked for ${answer.askedForMs ?? '?'}ms`
  )
}

// The dev server's wait wins when there is one. A production run asks the
// background itself, and only when its files name a registration.
export function resolveBootRegistrationsWait(
  plugin: {
    awaitBootRegistrations?: BootRegistrationsWait
    bootRegistrationsFromBackground?: boolean
  },
  evaluate: BackgroundEvaluator | undefined,
  onAnswer?: (answer: BootRegistrationsAnswer) => void
): BootRegistrationsWait | undefined {
  if (plugin.awaitBootRegistrations) return plugin.awaitBootRegistrations
  if (!plugin.bootRegistrationsFromBackground || !evaluate) return undefined

  return backgroundBootRegistrationsWait(evaluate, onAnswer)
}
