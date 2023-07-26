// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

const assetLoaders = [
  {
    test: /\.(png|jpg|jpeg|gif|webp|avif|ico|bmp|svg)$/i,
    type: 'asset/resource'
  },
  {
    test: /\.(woff|woff2|eot|ttf|otf)$/i,
    type: 'asset/resource'
  },
  {
    test: /\.(csv|tsv)$/i,
    use: ['csv-loader']
  },
  {
    test: /\.xml$/i,
    use: ['xml-loader']
  }
]

export default assetLoaders
