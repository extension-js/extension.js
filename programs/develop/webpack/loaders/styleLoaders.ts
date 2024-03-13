import getCommonStyleLoaders from './commonStyleLoaders'

export default function styleLoaders(projectDir: string, opts: any) {
  return [
    {
      test: /\.css$/,
      exclude: /\.module\.css$/,
      type: 'javascript/auto',
      // https://stackoverflow.com/a/60482491/4902448
      use: getCommonStyleLoaders(projectDir, {
        regex: /\.css$/,
        mode: opts.mode
      })
    },
    {
      test: /\.module\.css$/,
      type: 'javascript/auto',
      // https://stackoverflow.com/a/60482491/4902448
      use: getCommonStyleLoaders(projectDir, {
        regex: /\.module\.css$/,
        mode: opts.mode
      })
    },
    {
      test: /\.(scss|sass)$/,
      exclude: /\.module\.css$/,
      // https://stackoverflow.com/a/60482491/4902448
      use: getCommonStyleLoaders(projectDir, {
        regex: /\.module\.css$/,
        loader: require.resolve('sass-loader'),
        mode: opts.mode
      })
    },
    {
      test: /\.module\.(scss|sass)$/,
      exclude: /\.module\.css$/,
      // https://stackoverflow.com/a/60482491/4902448
      use: getCommonStyleLoaders(projectDir, {
        regex: /\.module\.css$/,
        loader: require.resolve('sass-loader'),
        mode: opts.mode
      })
    },
    {
      test: /\.less$/,
      exclude: /\.module\.css$/,
      // https://stackoverflow.com/a/60482491/4902448
      use: getCommonStyleLoaders(projectDir, {
        regex: /\.module\.css$/,
        loader: require.resolve('less-loader'),
        mode: opts.mode
      })
    }
  ]
}
