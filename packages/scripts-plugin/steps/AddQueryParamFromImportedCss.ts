import path from 'path'
import {type Compiler} from 'webpack'

export default function RemoveQueryParamFromImportedCss(
  compiler: Compiler,
  manifestPath: string
) {
  compiler.options.module.rules.push({
    test: /\.(m?js|m?ts)x?$/,
    use: [
      {
        loader: path.resolve(__dirname, './loaders/InjectQueryParamLoader'),
        options: {
          manifestPath
        }
      }
    ]
  })
}
