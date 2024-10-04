import * as fs from 'fs'
import * as path from 'path'
import {Compiler} from 'webpack'

export class ResolveTsPathsConfig {
  apply(compiler: Compiler) {
    const tsConfigPath = path.resolve(process.cwd(), 'tsconfig.json')

    if (fs.existsSync(tsConfigPath)) {
      const tsConfig = JSON.parse(fs.readFileSync(tsConfigPath, 'utf-8'))

      if (tsConfig.compilerOptions && tsConfig.compilerOptions.paths) {
        const {paths} = tsConfig.compilerOptions

        // Convert TS paths to Webpack alias format
        const alias: Record<string, string> = {}
        for (const key in paths) {
          if (paths.hasOwnProperty(key)) {
            const aliasKey = key.replace('/*', '')
            const aliasPath = path.resolve(
              process.cwd(),
              paths[key][0].replace('/*', '')
            )
            alias[aliasKey] = aliasPath
          }
        }

        // Append to Webpack resolve.alias
        if (!compiler.options.resolve) {
          compiler.options.resolve = {}
        }
        if (!compiler.options.resolve.alias) {
          compiler.options.resolve.alias = {}
        }
        compiler.options.resolve.alias = {
          ...compiler.options.resolve.alias,
          ...alias
        }

        if (process.env.EXTENSION_ENV === 'development') {
          console.log(
            'Successfully appended TypeScript paths to Webpack alias:',
            alias
          )
        }
      } else {
        // No paths found in tsconfig.json. Continue silently...
      }
    } else {
      // tsconfig.json not found. Continue silently...
    }
  }
}
