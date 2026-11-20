import type {Compilation, Compiler} from '@rspack/core'
import type {BrowserType} from '../../../types'
import type {ReloadInstruction} from '../../classify-reload'
import type {ReloadBroker} from '../../reload-dispatch'
import {createReloadSession} from '../../reload-session'

// The name this stand-in taps `done` with, for the fake compiler's owner.
export const LAUNCHED_SESSION = 'spec-launched-session'

export interface CompiledBuild {
  isFirstCompile: boolean
  reloadInstruction?: ReloadInstruction
}

// The calls a plugin that launched a browser makes on a reload session, with
// no browser under it: the first build is the one the browser loads, and
// each later one is planned, delivered and reported. It outlives a compiler.
export function launchedSession(options: {
  browser: BrowserType
  broker?: ReloadBroker
}) {
  const session = createReloadSession({browser: options.browser})
  const compiled: CompiledBuild[] = []
  let isFirstCompile = true

  if (options.broker) session.connect(options.broker)

  return {
    compiled,
    apply(compiler: Compiler) {
      const builds = session.watch(compiler)

      compiler.hooks.done.tapPromise(LAUNCHED_SESSION, async (stats) => {
        const compilation = stats.compilation as Compilation

        if (compilation.errors && compilation.errors.length > 0) return

        if (isFirstCompile) {
          isFirstCompile = false
          session.loaded(compilation)
          compiled.push({isFirstCompile: true})

          return
        }

        const plan = builds.plan(compilation)

        if (!plan.held) await session.deliver(plan.instruction, compilation)

        compiled.push({
          isFirstCompile: false,
          reloadInstruction: plan.instruction
        })
      })
    }
  }
}
