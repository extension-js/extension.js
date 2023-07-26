/* eslint-env jasmine */
const path = require('path')
const webpack = require('webpack')

const demoWebpackConfig = (demoDir) =>
  require(path.join(__dirname, 'fixtures', demoDir, 'webpack.config.js'))

const demoManifestPath = (demoDir) =>
  require(path.join(__dirname, 'fixtures', demoDir, 'dist', 'manifest.json'))

describe('ManifestPlugin', function () {
  describe('v3 manifest entries', function () {
    const webpackConfig = demoWebpackConfig('v3')

    beforeAll(function (done) {
      webpack(webpackConfig, function (err) {
        expect(err).toBeFalsy()
        setTimeout(done, 2500)
      })
    })

    it('updates `background.service_worker` field entry', function (done) {
      const distManifest = require(demoManifestPath('v3'))
      const expected = 'service_worker.js'

      const actual = distManifest.background.service_worker
      expect(actual).toEqual(expected)
      done()
    })

    it('updates `action.default_icon` field entry', function (done) {
      const distManifest = require(demoManifestPath('v3'))
      const actual = distManifest.action.default_icon
      const expected = {
        16: 'test_16.png',
        32: 'test_32.png',
        48: 'test_48.png',
        64: 'test_64.png'
      }

      expect(actual).toEqual(expected)
      done()
    })

    it('updates `action.default_popup` field entry', function (done) {
      const distManifest = require(demoManifestPath('v3'))
      const actual = distManifest.action.default_popup
      const expected = 'popup.html'

      expect(actual).toEqual(expected)
      done()
    })

    it('updates `web_accessible_resources` field entry using globs', function (done) {
      const distManifest = require(demoManifestPath('v3'))
      const actual = distManifest.web_accessible_resources
      const expected = [
        {
          resources: ['webResources/test.png', 'webResources/test.svg'],
          matches: ['<all_urls>']
        }
      ]

      expect(actual).toEqual(expected)
      done()
    })
  })
})
