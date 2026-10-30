import {describe, expect, it} from 'vitest'
import {sanitize} from '../zip'

describe('zip name slug', () => {
  it('transliterates accented letters instead of dropping them', () => {
    expect(sanitize('Soccer Broadcast Lens: análise ao vivo de futebol')).toBe(
      'soccer-broadcast-lens-analise-ao-vivo-de-futebol'
    )

    expect(sanitize('Configuração')).toBe('configuracao')
    expect(sanitize('Señal en español')).toBe('senal-en-espanol')
    expect(sanitize('Éditeur de thème français')).toBe(
      'editeur-de-theme-francais'
    )
  })

  it('spells out letters that carry no separate accent mark', () => {
    expect(sanitize('Straße Œuvre Ørsted')).toBe('strasse-oeuvre-orsted')
  })

  it('falls back to a readable name when nothing Latin is left', () => {
    expect(sanitize('拡張機能')).toBe('extension')
  })
})
