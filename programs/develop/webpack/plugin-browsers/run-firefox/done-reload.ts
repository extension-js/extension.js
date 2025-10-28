import type {Compiler} from '@rspack/core'

type RemoteController = {
  hardReload: (compilation: any, changedAssets: string[]) => Promise<void>
}

export class FirefoxDoneReloadPlugin {
  private readonly getController: () => RemoteController | undefined
  private readonly logger: ReturnType<Compiler['getInfrastructureLogger']>

  constructor(
    getController: () => RemoteController | undefined,
    logger: ReturnType<Compiler['getInfrastructureLogger']>
  ) {
    this.getController = getController
    this.logger = logger
  }

  apply(compiler: Compiler) {
    compiler.hooks.done.tapAsync('run-firefox:module', async (stats, done) => {
      const hasErrors =
        typeof stats?.hasErrors === 'function'
          ? stats.hasErrors()
          : !!stats?.compilation?.errors?.length

      if (hasErrors) {
        done()
        return
      }

      try {
        const compilation = stats?.compilation
        const assetsArr: Array<{name: string; emitted?: boolean}> =
          Array.isArray(compilation?.getAssets?.())
            ? (compilation!.getAssets() as any)
            : []

        const changed = assetsArr
          .filter((a) => (a as any)?.emitted)
          .map((a) => String((a as any)?.name || ''))

        const controller = this.getController()
        if (controller) {
          await controller.hardReload(stats.compilation, changed)
        }
      } catch {
        // Ignore
      }

      done()
    })
  }
}
