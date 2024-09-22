/** @type {import('extension').FileConfig} */

module.exports = {
  config: (config) => {
    config.output.publicPath =
      'chrome-extension://egknoknehanlgkjlhphfgfgbpjinmjie/'
    return config
  }
}
