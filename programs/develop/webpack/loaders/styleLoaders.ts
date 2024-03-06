import getCommonStyleLoaders from './commonStyleLoaders'

export default function styleLoaders(projectDir: string, opts: any) {
  return [
    {
      test: /\.(scss|sass)$/,
      exclude: /\.module\.css$/,
      use: getCommonStyleLoaders(projectDir, {
        regex: /\.module\.css$/,
        mode: opts.mode
      })
    },
    {
      test: /\.module\.(scss|sass)$/,
      use: getCommonStyleLoaders(projectDir, {
        regex: /\.module\.css$/,
        loader: require.resolve('sass-loader'),
        mode: opts.mode
      })
    },
    {
      test: /\.less$/,
      use: getCommonStyleLoaders(projectDir, {
        regex: /\.module\.css$/,
        loader: require.resolve('less-loader'),
        mode: opts.mode
      })
    }
  ]
}
