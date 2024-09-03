/** @type {import('extension-develop').FileConfig} */
module.exports = {
  config: (config) => {
    config.output.publicPath =
      'chrome-extension://egknoknehanlgkjlhphfgfgbpjinmjie/'
    return config
  }
}
