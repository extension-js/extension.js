/* eslint-env jasmine */
const fs = require('fs')
const path = require('path')
const webpack = require('webpack')

const demoWebpackConfig = (demoDir) =>
  require(path.join(__dirname, 'fixtures', demoDir, 'webpack.config.js'))

describe('IconsPlugin', function () {
  describe('settings overrides default icon', function () {
    const webpackConfig = demoWebpackConfig('settings-overrides-favicon-url')

    beforeAll(function (done) {
      webpack(webpackConfig, function (err) {
        expect(err).toBeFalsy()
        setTimeout(done, 4000)
      })
    })

    it('outputs icon file to destination folder', function (done) {
      const jsFile = path.resolve(webpackConfig.output.path, 'icons/puzzle.png')

      fs.readFile(jsFile, {encoding: 'utf8'}, function (err, data) {
        if (err) {
          throw err
        }
        expect(data).toBeDefined()
        done()
      })
    })
  })
})
