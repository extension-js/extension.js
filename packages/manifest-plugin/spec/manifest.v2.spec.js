/* eslint-env jasmine */
const path = require('path')
const webpack = require('webpack')

const demoWebpackConfig = (demoDir) =>
  require(path.join(__dirname, 'fixtures', demoDir, 'webpack.config.js'))

const demoManifestPath = (demoDir) =>
  require(path.join(__dirname, 'fixtures', demoDir, 'dist', 'manifest.json'))

describe('ManifestPlugin', function () {
  describe('v2 manifest entries', function () {
    const webpackConfig = demoWebpackConfig('v2')

    beforeAll(function (done) {
      webpack(webpackConfig, function (err) {
        expect(err).toBeFalsy()
        setTimeout(done, 2500)
      })
    })

    it('updates `background.page` field entry', function (done) {
      const distManifest = demoManifestPath('v2')
      const expected = 'background.background.html'

      const actual = distManifest.background.page
      expect(actual).toEqual(expected)
      done()
    })

    it('updates `browser_action.default_icon` field entry', function (done) {
      const distManifest = demoManifestPath('v2')
      const actual = distManifest.browser_action.default_icon
      const expected = {
        16: 'icons/test_16.png',
        32: 'icons/test_32.png',
        48: 'icons/test_48.png',
        64: 'icons/test_64.png'
      }

      expect(actual).toEqual(expected)
      done()
    })

    it('updates `browser_action.default_popup` field entry', function (done) {
      const distManifest = demoManifestPath('v2')
      const actual = distManifest.browser_action.default_popup
      const expected = 'action.popup.html'

      expect(actual).toEqual(expected)
      done()
    })

    it('updates `browser_action.theme_icon` field entry', function (done) {
      const distManifest = demoManifestPath('v2')
      const actual = distManifest.browser_action.theme_icons
      const expected = [
        {
          light: 'icons/test_16-light.png',
          dark: 'icons/test_16.png',
          size: 16
        },
        {
          light: 'icons/test_32-light.png',
          dark: 'icons/test_32.png',
          size: 32
        },
        {
          light: 'icons/test_48-light.png',
          dark: 'icons/test_48.png',
          size: 48
        },
        {
          light: 'icons/test_64-light.png',
          dark: 'icons/test_64.png',
          size: 64
        },
        {
          light: 'icons/test_128-light.png',
          dark: 'icons/test_128.png',
          size: 128
        }
      ]

      expect(actual).toEqual(expected)
      done()
    })

    it('updates `web_accessible_resources` field entry using globs', function (done) {
      const distManifest = demoManifestPath('v2')
      const actual = distManifest.web_accessible_resources
      const expected = ['resources/*']

      expect(actual).toEqual(expected)
      done()
    })
  })
})
