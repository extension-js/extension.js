// ██████╗ ███████╗██╗      ██████╗  █████╗ ██████╗
// ██╔══██╗██╔════╝██║     ██╔═══██╗██╔══██╗██╔══██╗
// ██████╔╝█████╗  ██║     ██║   ██║███████║██║  ██║
// ██╔══██╗██╔══╝  ██║     ██║   ██║██╔══██║██║  ██║
// ██║  ██║███████╗███████╗╚██████╔╝██║  ██║██████╔╝
// ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {Compilation, Compiler} from '@rspack/core'
import {loadedContentScriptsFor, reloadForBuild} from './build-reload'
import type {ReloadInstruction} from './classify-reload'
import {
  mergeReloadInstructions,
  reloadSurvivingPackage
} from './reload-after-package'
import {
  createChangedSourcesTracker,
  dispatchReload,
  type ReloadBroker
} from './reload-dispatch'
import {
  readBootRegistrations,
  readDevBuild
} from './steps/inject-bridge-producer'

// Whether a build carries the reload pipeline at all.
export function isReloadSession(
  mode: string | undefined,
  devSession: boolean | undefined
): boolean {
  return (
    mode !== 'production' &&
    // A shippable development build carries no reload client.
    devSession !== false &&
    process.env.EXTENSION_NO_RELOAD !== 'true'
  )
}

// True for a build a pending restart replaces. The dev server owns restarts
// and hands this in, so the session never asks it directly.
type BuildHold = (compiler: object, compilation?: object) => boolean

interface ReloadSessionOptions {
  browser: string
  // The browser reloads by installing a new package, which restarts the
  // extension, so only what a restart cannot deliver is sent after it.
  packaged?: boolean
}

export interface ReloadPlan {
  held: boolean
  instruction?: ReloadInstruction
}

interface CompilerReloads {
  // What a rebuild of this compiler reloads, unless a restart replaces it.
  plan(compilation: Compilation): ReloadPlan
}

export interface ReloadSession {
  connect(broker: ReloadBroker): void
  // Builds a pending restart replaces send nothing. The restart reloads once.
  hold(isHeld: BuildHold): void
  watch(compiler: Compiler): CompilerReloads
  // This build is what the browser reads now: a launch, a retry, a first build.
  loaded(compilation: Compilation): void
  // Sends a planned reload. True only when the extension took it.
  deliver(
    instruction: ReloadInstruction | undefined,
    compilation?: Compilation
  ): Promise<boolean>
  // Two plans a single package carries, for a save burst.
  combine(
    previous: ReloadInstruction | undefined,
    next: ReloadInstruction | undefined
  ): ReloadInstruction | undefined
  // The first page waits on a background that registers content scripts.
  bootRegistrationsWait(
    compilation: object
  ): ((timeoutMs: number) => Promise<'settled' | 'timeout'>) | undefined
}

// The longest a delivery holds the next build. The broker bounds its own
// waits below this: five seconds to wake a worker and three for the receipt.
export const RELOAD_DELIVERY_HOLD_MS = 10_000

// One owner for the reload of a dev session. What the browser read outlives
// a restart of the compiler, so a caller keeps one session for its lifetime.
export function createReloadSession(
  options: ReloadSessionOptions
): ReloadSession {
  const loadedScripts = options.packaged
    ? undefined
    : loadedContentScriptsFor(options.browser)
  let broker: ReloadBroker | undefined
  let isHeld: BuildHold | undefined
  // The delivery that is out, which the next build of a watched compiler
  // waits for.
  let delivering: Promise<void> | null = null

  const send = async (
    instruction: ReloadInstruction | undefined,
    compilation?: Compilation
  ): Promise<boolean> => {
    if (!broker) return false

    if (options.packaged) {
      // The new package restarts the extension, so a dispatch that finds no
      // worker is expected, and the package itself is the applied reload.
      const delivered = instruction
        ? await dispatchReload(instruction, {
            broker,
            producerRestartExpected: true
          })
        : false

      broker.noteReloadApplied('safari-resync', instruction?.label)

      return delivered
    }

    const delivered = await dispatchReload(instruction, {
      broker,
      build: readDevBuild(compilation)
    })

    loadedScripts?.settle(delivered)

    return delivered
  }

  return {
    connect(next) {
      broker = next
    },

    hold(next) {
      isHeld = next
    },

    watch(compiler) {
      const changedSources = createChangedSourcesTracker(compiler)

      // The browser reads the dist for the reload it was sent, and a done
      // hook that is still out does not keep the bundler from starting a build.
      compiler.hooks.watchRun.tapPromise('extjs-reload-delivery', async () => {
        if (delivering) await delivering
      })

      return {
        plan(compilation) {
          if (isHeld?.(compiler, compilation)) return {held: true}

          const instruction = reloadForBuild(compilation, {
            changedSources,
            loaded: loadedScripts
          })

          return {
            held: false,
            instruction: options.packaged
              ? reloadSurvivingPackage(instruction)
              : instruction
          }
        }
      }
    },

    loaded(compilation) {
      loadedScripts?.noteLoaded(compilation)
    },

    deliver(instruction, compilation) {
      const delivery = send(instruction, compilation)
      const settled: Promise<void> = new Promise((resolve) => {
        // The hold ends with the delivery or at its bound, whichever is
        // first, so a broker that never answers cannot stop the builds.
        const bound = setTimeout(resolve, RELOAD_DELIVERY_HOLD_MS)

        bound.unref?.()
        void delivery.then(
          () => resolve(),
          () => resolve()
        )

        void delivery.finally(() => clearTimeout(bound)).catch(() => undefined)
      })

      delivering = settled
      void settled.then(() => {
        if (delivering === settled) delivering = null
      })

      return delivery
    },

    combine: mergeReloadInstructions,

    bootRegistrationsWait(compilation) {
      const current = broker

      if (!current) return undefined
      if (!readBootRegistrations(compilation)) return undefined

      return (timeoutMs) => current.awaitBootRegistrations(timeoutMs)
    }
  }
}

// A session with no browser plugin: the first build is what the browser
// loads, and each later one reloads through the broker.
export function reloadEachBuild(
  compiler: Compiler,
  options: {browser: string; broker: ReloadBroker; isHeld?: BuildHold}
): void {
  const session = createReloadSession({browser: options.browser})
  const builds = session.watch(compiler)
  let first = true

  session.connect(options.broker)
  if (options.isHeld) session.hold(options.isHeld)

  compiler.hooks.done.tapPromise('extjs-no-browser-reload', async (stats) => {
    const compilation = stats.compilation
    if (compilation.errors.length > 0) return

    if (first) {
      first = false
      session.loaded(compilation)

      return
    }

    const plan = builds.plan(compilation)
    if (plan.held) return

    await session.deliver(plan.instruction, compilation)
  })
}
