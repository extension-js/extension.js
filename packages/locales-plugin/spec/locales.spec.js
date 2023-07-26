/* eslint-env jasmine */
const fs = require('fs')
const path = require('path')
const webpack = require('webpack')

const demoWebpackConfig = (demoDir) =>
  require(path.join(__dirname, 'fixtures', demoDir, 'webpack.config.js'))

describe('WebResourcesPlugin', function () {
  describe('when default_locale is set', function () {
    const webpackConfig = demoWebpackConfig('locales-default')

    beforeAll(function (done) {
      webpack(webpackConfig, function (err) {
        expect(err).toBeFalsy()
        done()
      })
    })

    it('output locale files to dist path', function (done) {
      const localeFile = path.resolve(
        webpackConfig.output.path,
        '_locales',
        'en',
        'messages.json'
      )

      expect(fs.existsSync(localeFile)).toBe(true)
      done()
    })
  })
})
