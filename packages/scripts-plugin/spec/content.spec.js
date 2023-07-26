/* eslint-env jasmine */
const fs = require('fs')
const path = require('path')
const webpack = require('webpack')

const demoWebpackConfig = (demoDir) =>
  require(path.join(__dirname, 'fixtures', demoDir, 'webpack.config.js'))

describe('ScriptsPlugin', function () {
  describe('content scripts', function () {
    describe('without hot-module-replacement', function () {
      const webpackConfig = demoWebpackConfig('content-js')

      beforeAll(function (done) {
        webpack({...webpackConfig, mode: 'production'}, function (err) {
          expect(err).toBeFalsy()
          setTimeout(done, 4000)
        })
      })

      it('outputs css file to destination folder', function (done) {
        const cssFile = path.resolve(
          webpackConfig.output.path,
          'contentScripts.style1.css'
        )

        fs.readFile(cssFile, {encoding: 'utf8'}, function (err, data) {
          expect(data).toBeDefined()
          done()
        })
      })

      it('outputs js file to destination folder', function (done) {
        const jsFile = path.resolve(
          webpackConfig.output.path,
          'contentScripts.content1.js'
        )

        fs.readFile(jsFile, {encoding: 'utf8'}, function (err, data) {
          expect(data).toBeDefined()
          done()
        })
      })
    })

    describe('with hot-module-replacement (TODO)', function () {
      const webpackConfig = demoWebpackConfig('content-js')

      beforeAll(function (done) {
        webpack(webpackConfig, function (err) {
          expect(err).toBeFalsy()
          setTimeout(done, 4000)
        })
      })

      it('outputs css file to destination folder', function (done) {
        const cssFile = path.resolve(
          webpackConfig.output.path,
          'contentScripts.style1.css'
        )

        fs.readFile(cssFile, {encoding: 'utf8'}, function (err, data) {
          // expect(data).toBeDefined()
          done()
        })
      })

      it('outputs js file to destination folder', function (done) {
        const jsFile = path.resolve(
          webpackConfig.output.path,
          'contentScripts.hmr-bundle.js'
        )

        fs.readFile(jsFile, {encoding: 'utf8'}, function (err, data) {
          // expect(data).toBeDefined()
          done()
        })
      })
    })
  })
})
