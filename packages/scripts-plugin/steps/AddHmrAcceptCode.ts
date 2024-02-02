import path from 'path'
import {type Compiler} from 'webpack'

export default function AddHmrAcceptCode(
  compiler: Compiler,
  manifestPath: string
) {
  compiler.options.module.rules.push({
    test: /\.(t|j)sx?$/,
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
