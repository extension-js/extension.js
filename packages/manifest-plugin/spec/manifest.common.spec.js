/* eslint-env jasmine */
const path = require('path')
const webpack = require('webpack')

const demoWebpackConfig = (demoDir) =>
  require(path.join(__dirname, 'fixtures', demoDir, 'webpack.config.js'))

const demoManifestPath = (demoDir) =>
  require(path.join(__dirname, 'fixtures', demoDir, 'dist', 'manifest.json'))

describe('ManifestPlugin', function () {
  describe('common manifest entries', function () {
    const webpackConfig = demoWebpackConfig('common')

    beforeAll(function (done) {
      webpack(webpackConfig, function (err) {
        expect(err).toBeFalsy()
        setTimeout(done, 2500)
      })
    })

    it('updates `background.scripts` field entry', function (done) {
      const distManifest = demoManifestPath('common')
      const expected = [
        'background.background1.js',
        'background.background2.js',
        'background.background3.js'
      ]

      const actual = distManifest.background.scripts

      expect(actual).toEqual(expected)
      done()
    })

    it('updates all `content_scripts` (js) field entries', function (done) {
      const distManifest = demoManifestPath('common')
      const actual1 = distManifest.content_scripts[0].js
      const expected1 = [
        'contentScripts.content1.js',
        'contentScripts.content2.js'
      ]
      expect(actual1).toEqual(expected1)

      const actual2 = distManifest.content_scripts[1].js
      const expected2 = [
        'contentScripts.content3.js',
        'contentScripts.content4.js'
      ]
      expect(actual2).toEqual(expected2)
      done()
    })

    it('updates `content.scripts.css` field entry', function (done) {
      const distManifest = demoManifestPath('common')
      const actual1 = distManifest.content_scripts[0].css
      const expected1 = [
        'contentScripts.content1.css',
        'contentScripts.content2.css'
      ]
      expect(actual1).toEqual(expected1)

      const actual2 = distManifest.content_scripts[1].css
      const expected2 = [
        'contentScripts.content3.css',
        'contentScripts.content4.css'
      ]
      expect(actual2).toEqual(expected2)
      done()
    })

    it('updates `icons` field entry', function (done) {
      const distManifest = demoManifestPath('common')
      const actual = distManifest.icons
      const expected = {
        16: 'icons.test_16.png',
        32: 'icons.test_32.png',
        48: 'icons.test_48.png',
        64: 'icons.test_64.png'
      }

      expect(actual).toEqual(expected)
      done()
    })

    it('updates `page_action.default_icon` field entry', function (done) {
      const distManifest = demoManifestPath('common')
      const actual = distManifest.page_action.default_icon
      const expected = {
        16: 'action.test_16.png',
        32: 'action.test_32.png',
        48: 'action.test_48.png',
        64: 'action.test_64.png'
      }

      expect(actual).toEqual(expected)
      done()
    })

    it('updates `page_action.default_popup` field entry', function (done) {
      const distManifest = demoManifestPath('common')
      const actual = distManifest.page_action.default_popup
      const expected = 'action.popup.html'

      expect(actual).toEqual(expected)
      done()
    })

    it('updates `chrome_url_overrides` field entry for newtab', function (done) {
      const distManifest = demoManifestPath('common')
      const actual = distManifest.chrome_url_overrides.newtab
      const expected = 'newtab.newtab.html'

      expect(actual).toEqual(expected)
      done()
    })

    it('updates `devtools_page` field entry', function (done) {
      const distManifest = demoManifestPath('common')
      const actual = distManifest.devtools_page
      const expected = 'devtools.devtools.html'

      expect(actual).toEqual(expected)
      done()
    })

    it('updates `options_page` field entry', function (done) {
      const distManifest = demoManifestPath('common')
      const actual = distManifest.options_page
      const expected = 'options.options.html'

      expect(actual).toEqual(expected)
      done()
    })

    it('updates `options_ui` field entry', function (done) {
      const distManifest = demoManifestPath('common')
      const actual = distManifest.options_ui.page
      const expected = 'options.options.html'

      expect(actual).toEqual(expected)
      done()
    })

    it('updates `sidebar_action.default_icon` field entry', function (done) {
      const distManifest = demoManifestPath('common')
      const actual = distManifest.sidebar_action.default_icon
      const expected = 'sidebar.test_16.png'

      expect(actual).toEqual(expected)
      done()
    })

    it('updates `sidebar_action.default_panel` field entry', function (done) {
      const distManifest = demoManifestPath('common')
      const actual = distManifest.sidebar_action.default_panel
      const expected = 'sidebar.sidebar.html'

      expect(actual).toEqual(expected)
      done()
    })

    it('updates `chrome_settings_overrides.homepage` field entry', function (done) {
      const distManifest = demoManifestPath('common')
      const actual = distManifest.chrome_settings_overrides.homepage
      const expected = 'settings.custom.html'

      expect(actual).toEqual(expected)
      done()
    })

    it('updates `chrome_settings_overrides.favicon_url` field entry', function (done) {
      const distManifest = demoManifestPath('common')
      const actual = distManifest.chrome_settings_overrides.favicon_url
      const expected = 'settings.favicon.ico'

      expect(actual).toEqual(expected)
      done()
    })

    it('updates `user_scripts.api_script` field entry', function (done) {
      const distManifest = demoManifestPath('common')
      const actual = distManifest.user_scripts.api_script
      const expected = 'userScripts.apiscript.js'

      expect(actual).toEqual(expected)
      done()
    })

    it('updates `sandbox` field entry', function (done) {
      const distManifest = demoManifestPath('common')
      const actual = distManifest.sandbox.pages[0]
      const expected = 'sandbox.page1.html'

      expect(actual).toEqual(expected)
      done()
    })
  })
})
