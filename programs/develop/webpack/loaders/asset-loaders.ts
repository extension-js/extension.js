// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

const assetLoaders = [
  {
    test: /\.(png|jpg|jpeg|gif|webp|avif|ico|bmp|svg)$/i,
    type: 'asset/resource',
    parser: {
      dataUrlCondition: {
        // inline images < 2 KB
        maxSize: 2 * 1024
      }
    }
  },
  {
    test: /\.(woff|woff2|eot|ttf|otf)$/i,
    type: 'asset/resource'
  },
  {
    test: /\.(txt|md|csv|tsv|xml|pdf|docx|doc|xls|xlsx|ppt|pptx|zip|gz|gzip|tgz)$/i,
    type: 'asset/resource',
    parser: {
      dataUrlCondition: {
        // inline images < 2 KB
        maxSize: 2 * 1024
      }
    }
  },
  {
    test: /\.(csv|tsv)$/i,
    use: ['csv-loader']
  }
]

export default assetLoaders
