import {describe, it, expect} from 'vitest'
import {
  patchWebResourcesV2,
  patchWebResourcesV3
} from '../../../../steps/setup-reload-strategy/apply-manifest-dev-defaults/patch-web-resources'
import {type Manifest} from '../../../../../webpack-types'

describe('patch-web-resources', () => {
  describe('patchWebResourcesV2', () => {
    it('should return default resources when no web_accessible_resources is present', () => {
      const manifest = {} as Manifest
      const result = patchWebResourcesV2(manifest)
      expect(result).toEqual([
        '/*.json',
        '/*.js',
        '/*.css',
        '/*.scss',
        '/*.sass',
        '/*.less',
        '*.styl'
      ])
    })

    it('should merge default resources with existing ones', () => {
      const manifest = {
        web_accessible_resources: ['custom/*.js', 'assets/*.png']
      } as Manifest
      const result = patchWebResourcesV2(manifest)
      expect(result).toContain('custom/*.js')
      expect(result).toContain('assets/*.png')
      expect(result).toContain('/*.json')
      expect(result).toContain('/*.js')
      expect(result).toContain('/*.css')
    })

    it('should not duplicate resources', () => {
      const manifest = {
        web_accessible_resources: ['/*.js', '/*.css']
      } as Manifest
      const result = patchWebResourcesV2(manifest)
      const jsCount = result.filter((r) => r === '/*.js').length
      const cssCount = result.filter((r) => r === '/*.css').length
      expect(jsCount).toBe(1)
      expect(cssCount).toBe(1)
    })

    it('should handle empty web_accessible_resources array', () => {
      const manifest = {
        web_accessible_resources: []
      } as Manifest
      const result = patchWebResourcesV2(manifest)
      expect(result).toEqual([
        '/*.json',
        '/*.js',
        '/*.css',
        '/*.scss',
        '/*.sass',
        '/*.less',
        '*.styl'
      ])
    })
  })

  describe('patchWebResourcesV3', () => {
    it('should return default resources with matches when no web_accessible_resources is present', () => {
      const manifest = {} as Manifest
      const result = patchWebResourcesV3(manifest)
      expect(result).toEqual([
        {
          resources: [
            '/*.json',
            '/*.js',
            '/*.css',
            '/*.scss',
            '/*.sass',
            '/*.less',
            '*.styl'
          ],
          matches: ['<all_urls>']
        }
      ])
    })

    it('should preserve existing web_accessible_resources and add default ones', () => {
      const manifest = {
        web_accessible_resources: [
          {
            resources: ['custom/*.js'],
            matches: ['https://example.com/*']
          }
        ]
      } as Manifest
      const result = patchWebResourcesV3(manifest)
      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        resources: ['custom/*.js'],
        matches: ['https://example.com/*']
      })
      expect(result[1]).toEqual({
        resources: [
          '/*.json',
          '/*.js',
          '/*.css',
          '/*.scss',
          '/*.sass',
          '/*.less',
          '*.styl'
        ],
        matches: ['<all_urls>']
      })
    })

    it('should handle empty web_accessible_resources array', () => {
      const manifest = {
        web_accessible_resources: []
      } as Manifest
      const result = patchWebResourcesV3(manifest)
      expect(result).toEqual([
        {
          resources: [
            '/*.json',
            '/*.js',
            '/*.css',
            '/*.scss',
            '/*.sass',
            '/*.less',
            '*.styl'
          ],
          matches: ['<all_urls>']
        }
      ])
    })
  })
})
