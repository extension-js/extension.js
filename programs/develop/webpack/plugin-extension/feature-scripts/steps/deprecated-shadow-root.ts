import {type Compiler} from 'webpack'

export class DeprecatedShadowRoot {
  apply(compiler: Compiler) {
    // Hook into the beforeRun stage to suppress CSS support warnings
    compiler.hooks.beforeRun.tap('deprecated-shadow-root', () => {
      // Clear any existing webpack warnings
      compiler.options.infrastructureLogging = {
        ...compiler.options.infrastructureLogging,
        level: 'none' // Use level instead of warnings to control logging
      }

      // Also intercept console warnings
      const originalWarnings = console.warn
      console.warn = function (...args: any[]) {
        const message = args.join(' ')
        if (message.includes('experiments.css')) {
          return
        }
        originalWarnings.apply(console, args)
      }
    })
  }
}
