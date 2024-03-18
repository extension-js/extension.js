const path = require('path')
const fs = require('fs')

const [, pathOrRemoteUrl] = process.argv.slice(2)
const projectDir = pathOrRemoteUrl.startsWith('http')
  ? process.cwd() + path.basename(pathOrRemoteUrl)
  : path.resolve(__dirname, pathOrRemoteUrl)

const tailwindConfig = path.join(projectDir, 'tailwind.config.js')

/** @type {import('tailwindcss').Config} */
const tailwindConfigData = fs.existsSync(tailwindConfig)
  ? require(tailwindConfig)
  : {content: []}

/** @type {import('tailwindcss').Config} */
const tailwindRootConfig = {
  ...tailwindConfigData,
  content: [
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    ...tailwindConfigData.content.map((file) => path.join(projectDir, file))
  ]
}

module.exports = tailwindRootConfig
