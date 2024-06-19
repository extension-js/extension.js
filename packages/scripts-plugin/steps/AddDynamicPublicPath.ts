import path from 'path'
import {type Compiler} from 'webpack'

export default function AddDynamicPublicPath(
  compiler: Compiler,
  manifestPath: string
) {
  compiler.options.module.rules.push({
    test: /\.(m?js|m?ts)x?$/,
    use: [
      {
        loader: path.resolve(__dirname, './loaders/InjectHMRAcceptLoader'),
        options: {
          manifestPath
        }
      }
    ]
  })
}
