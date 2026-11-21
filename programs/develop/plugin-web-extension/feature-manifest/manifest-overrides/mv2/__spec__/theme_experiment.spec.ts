import {describe, expect, it} from 'vitest'
import type {Manifest} from '../../../../../types'
import {themeExperiment} from '../theme_experiment'

describe('theme_experiment override', () => {
  it('names the compiled stylesheet under theme_experiment/', () => {
    const out = themeExperiment({
      theme_experiment: {stylesheet: 'theme/chrome.scss', colors: {a: 'b'}}
    } as Manifest) as Manifest
    expect(out.theme_experiment?.stylesheet).toBe('theme_experiment/chrome.css')
    expect(out.theme_experiment?.colors).toEqual({a: 'b'})
  })

  it('does not invent a stylesheets promise', () => {
    const out = themeExperiment({
      theme_experiment: {stylesheets: ['a.css', 'b.css']}
    } as Manifest) as Manifest
    expect(out.theme_experiment?.stylesheets).toEqual(['a.css', 'b.css'])
    expect(out.theme_experiment?.stylesheet).toBeUndefined()
  })
})
