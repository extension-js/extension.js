// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

// import RemarkHTML from 'remark-html'

const htmlLoaders = [
  {
    test: /\.html$/i,
    loader: 'html-loader'
  },
  {
    test: /\.md$/,
    use: [
      {
        loader: 'html-loader'
      }
      // TODO
      // {
      //   loader: 'remark-loader',
      //   options: {
      //     remarkOptions: {
      //       plugins: [RemarkHTML]
      //     }
      //   }
      // }
    ]
  }
]

export default htmlLoaders
