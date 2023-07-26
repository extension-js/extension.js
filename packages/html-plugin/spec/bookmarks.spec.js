/* eslint-env jasmine */
const fs = require('fs')
const path = require('path')
const webpack = require('webpack')
const jsdom = require('jsdom')

const {JSDOM} = jsdom

const demoWebpackConfig = (demoDir) =>
  require(path.join(__dirname, 'fixtures', demoDir, 'webpack.config.js'))

describe('HtmlPlugin', function () {
  describe('browser bookmarks html', function () {
    const webpackConfig = demoWebpackConfig('bookmarks-html')

    beforeAll(function (done) {
      webpack(webpackConfig, function (err) {
        expect(err).toBeFalsy()
        done()
      })
    })

    it('outputs html file to destination folder with css paths resolved', function (done) {
      const htmlFile = path.resolve(
        webpackConfig.output.path,
        'bookmarks.bookmarks.html'
      )

      fs.readFile(htmlFile, {encoding: 'utf8'}, function (err, data) {
        const {document} = new JSDOM(data).window

        const stylesheets = [...document.querySelectorAll('link')]

        expect(stylesheets[0].href).toBe('bookmarks.bookmarks.css')

        done()
      })
    })

    it('outputs css file to destination folder', function (done) {
      const jsFile = path.resolve(
        webpackConfig.output.path,
        'bookmarks.bookmarks.css'
      )

      fs.readFile(jsFile, {encoding: 'utf8'}, function (err, data) {
        expect(data).toBeDefined()
        done()
      })
    })

    describe('without hot-module-replacement', function () {
      it('outputs html file to destination folder with js paths resolved', function (done) {
        const htmlFile = path.resolve(
          webpackConfig.output.path,
          'bookmarks.bookmarks.html'
        )

        fs.readFile(htmlFile, {encoding: 'utf8'}, function (err, data) {
          const {document} = new JSDOM(data).window

          const scripts = [...document.querySelectorAll('script')]

          expect(scripts[0].src).toBe('bookmarks.bookmarks1.js')

          done()
        })
      })

      it('outputs js file to destination folder', function (done) {
        const jsFile = path.resolve(
          webpackConfig.output.path,
          'bookmarks.bookmarks1.js'
        )

        fs.readFile(jsFile, {encoding: 'utf8'}, function (err, data) {
          expect(data).toBeDefined()
          done()
        })
      })
    })

    describe('with hot-module-replacement (TODO)', function () {
      it('outputs html file to destination folder with js paths resolved', function (done) {
        const htmlFile = path.resolve(
          webpackConfig.output.path,
          'bookmarks.bookmarks.html'
        )

        fs.readFile(htmlFile, {encoding: 'utf8'}, function (err, data) {
          const {document} = new JSDOM(data).window

          const scripts = [...document.querySelectorAll('script')]

          // expect(scripts[0].src).toBe('bookmarks.hmr-bundle.js')

          done()
        })
      })

      it('outputs js file to destination folder', function (done) {
        const jsFile = path.resolve(
          webpackConfig.output.path,
          'bookmarks.hmr-bundle.js'
        )

        fs.readFile(jsFile, {encoding: 'utf8'}, function (err, data) {
          // expect(data).toBeDefined()
          done()
        })
      })
    })
  })
})
