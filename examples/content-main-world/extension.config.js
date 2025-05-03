/** @type {import('extension').FileConfig} */

const config = {
  config: (config) => {
    config.output.publicPath =
      'chrome-extension://egknoknehanlgkjlhphfgfgbpjinmjie/'
    return config
  }
}

export default config
