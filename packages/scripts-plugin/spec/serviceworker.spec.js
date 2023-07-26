/* eslint-env jasmine */
const fs = require('fs')
const path = require('path')
const webpack = require('webpack')

const demoWebpackConfig = (demoDir) =>
  require(path.join(__dirname, 'fixtures', demoDir, 'webpack.config.js'))

describe('ScriptsPlugin', function () {
  describe('service worker', function () {
    describe('without hot-module-replacement', function () {
      const webpackConfig = demoWebpackConfig('serviceworker-js')

      beforeAll(function (done) {
        webpack({...webpackConfig, mode: 'production'}, function (err) {
          expect(err).toBeFalsy()
          setTimeout(done, 2500)
        })
      })

      it('outputs js file to destination folder', function (done) {
        const jsFile = path.resolve(
          webpackConfig.output.path,
          'serviceWorker.serviceworker1.js'
        )

        fs.readFile(jsFile, {encoding: 'utf8'}, function (err, data) {
          expect(data).toBeDefined()
          done()
        })
      })
    })

    describe('with hot-module-replacement', function () {
      const webpackConfig = demoWebpackConfig('serviceworker-js')

      beforeAll(function (done) {
        webpack(webpackConfig, function (err) {
          // expect(err).toBeFalsy()
          setTimeout(done, 2500)
        })
      })

      it('outputs js file to destination folder', function (done) {
        const jsFile = path.resolve(
          webpackConfig.output.path,
          'serviceWorker.hmr-bundle.js'
        )

        fs.readFile(jsFile, {encoding: 'utf8'}, function (err, data) {
          // expect(data).toBeDefined()
          done()
        })
      })
    })
  })
})
