import type webpack from 'webpack'

export default function isHMREnabled(compiler: webpack.Compiler) {
  return (
    compiler.options.mode !== 'production' || !!compiler.options.devServer?.hot
  )
}
