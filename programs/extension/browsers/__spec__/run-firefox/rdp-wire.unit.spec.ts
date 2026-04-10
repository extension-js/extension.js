import {describe, it, expect} from 'vitest'
import {
  parseRdpFrame,
  buildRdpFrame
} from '../../run-firefox/firefox-source-inspection/remote-firefox/rdp-wire'

describe('RDP wire format', () => {
  // -----------------------------------------------------------------------
  // buildRdpFrame
  // -----------------------------------------------------------------------

  describe('buildRdpFrame', () => {
    it('encodes a payload as length:json', () => {
      const frame = buildRdpFrame({to: 'root', type: 'listTabs'})
      const [lenStr, ...rest] = frame.split(':')
      const json = rest.join(':')
      expect(parseInt(lenStr, 10)).toBe(Buffer.from(json).length)
      expect(JSON.parse(json)).toEqual({to: 'root', type: 'listTabs'})
    })

    it('handles unicode correctly via byte length', () => {
      const frame = buildRdpFrame({to: 'root', text: '日本語テスト'})
      const colonIdx = frame.indexOf(':')
      const len = parseInt(frame.substring(0, colonIdx), 10)
      const body = frame.substring(colonIdx + 1)
      expect(len).toBe(Buffer.from(body).length)
      // byte length > character length for multi-byte chars
      expect(len).toBeGreaterThan(body.length)
    })
  })

  // -----------------------------------------------------------------------
  // parseRdpFrame — single complete frame
  // -----------------------------------------------------------------------

  describe('parseRdpFrame — complete frames', () => {
    it('parses a single complete frame', () => {
      const payload = {from: 'root', tabs: []}
      const raw = buildRdpFrame(payload)
      const result = parseRdpFrame(Buffer.from(raw))

      expect(result.parsedMessage).toEqual(payload)
      expect(result.error).toBeUndefined()
      expect(result.remainingData.length).toBe(0)
    })

    it('returns remaining data after a complete frame', () => {
      const payload = {from: 'root', type: 'greeting'}
      const frame = buildRdpFrame(payload)
      const extra = 'leftover'
      const result = parseRdpFrame(Buffer.from(frame + extra))

      expect(result.parsedMessage).toEqual(payload)
      expect(result.remainingData.toString()).toBe(extra)
    })

    it('round-trips build → parse', () => {
      const original = {
        to: 'tab-1',
        type: 'evaluateJSAsync',
        text: 'location.href'
      }
      const frame = buildRdpFrame(original)
      const {parsedMessage} = parseRdpFrame(Buffer.from(frame))
      expect(parsedMessage).toEqual(original)
    })
  })

  // -----------------------------------------------------------------------
  // parseRdpFrame — incomplete / split frames
  // -----------------------------------------------------------------------

  describe('parseRdpFrame — incomplete frames', () => {
    it('returns input unchanged when frame is incomplete (no colon yet)', () => {
      const result = parseRdpFrame(Buffer.from('42'))
      expect(result.parsedMessage).toBeUndefined()
      expect(result.error).toBeUndefined()
      expect(result.remainingData.toString()).toBe('42')
    })

    it('returns input unchanged when body is shorter than declared length', () => {
      // Declare 100 bytes but only provide 10
      const partial = '100:{"short":1}'
      const result = parseRdpFrame(Buffer.from(partial))
      expect(result.parsedMessage).toBeUndefined()
      expect(result.error).toBeUndefined()
      expect(result.remainingData.toString()).toBe(partial)
    })

    it('handles frame split across two chunks', () => {
      const payload = {from: 'tab-1', result: {value: 'hello world'}}
      const frame = buildRdpFrame(payload)

      // Split in the middle
      const mid = Math.floor(frame.length / 2)
      const chunk1 = frame.substring(0, mid)
      const chunk2 = frame.substring(mid)

      // First chunk: incomplete
      const r1 = parseRdpFrame(Buffer.from(chunk1))
      expect(r1.parsedMessage).toBeUndefined()
      expect(r1.error).toBeUndefined()

      // Reassemble and parse
      const combined = Buffer.concat([r1.remainingData, Buffer.from(chunk2)])
      const r2 = parseRdpFrame(combined)
      expect(r2.parsedMessage).toEqual(payload)
      expect(r2.remainingData.length).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // parseRdpFrame — multiple frames in one chunk
  // -----------------------------------------------------------------------

  describe('parseRdpFrame — multiple frames in one chunk', () => {
    it('parses first frame and returns second as remaining data', () => {
      const msg1 = {from: 'root', tabs: [{actor: 'tab-1'}]}
      const msg2 = {from: 'tab-1', type: 'attached'}
      const combined = buildRdpFrame(msg1) + buildRdpFrame(msg2)

      // First parse
      const r1 = parseRdpFrame(Buffer.from(combined))
      expect(r1.parsedMessage).toEqual(msg1)
      expect(r1.remainingData.length).toBeGreaterThan(0)

      // Second parse on remaining data
      const r2 = parseRdpFrame(r1.remainingData)
      expect(r2.parsedMessage).toEqual(msg2)
      expect(r2.remainingData.length).toBe(0)
    })

    it('handles three frames concatenated', () => {
      const msgs = [
        {from: 'root', type: 'a'},
        {from: 'tab-1', type: 'b'},
        {from: 'tab-2', type: 'c'}
      ]
      let buf = Buffer.from(msgs.map(buildRdpFrame).join(''))
      const parsed: unknown[] = []

      while (buf.length > 0) {
        const r = parseRdpFrame(buf)
        if (!r.parsedMessage) break
        parsed.push(r.parsedMessage)
        buf = r.remainingData
      }

      expect(parsed).toEqual(msgs)
    })
  })

  // -----------------------------------------------------------------------
  // parseRdpFrame — error handling
  // -----------------------------------------------------------------------

  describe('parseRdpFrame — error cases', () => {
    it('returns fatal error for non-numeric length prefix', () => {
      const result = parseRdpFrame(Buffer.from('abc:{"bad":true}'))
      expect(result.error).toBeDefined()
      expect(result.fatal).toBe(true)
    })

    it('returns non-fatal error for invalid JSON body', () => {
      // Correct length but broken JSON
      const badJson = '{not valid json'
      const len = Buffer.from(badJson).length
      const frame = `${len}:${badJson}`
      const result = parseRdpFrame(Buffer.from(frame))

      expect(result.error).toBeDefined()
      expect(result.fatal).toBe(false)
      // Remaining data should skip past the bad frame
      expect(result.remainingData.length).toBe(0)
    })

    it('returns input unchanged for empty buffer', () => {
      const result = parseRdpFrame(Buffer.alloc(0))
      expect(result.parsedMessage).toBeUndefined()
      expect(result.error).toBeUndefined()
      expect(result.remainingData.length).toBe(0)
    })

    it('returns input unchanged for buffer with only colon', () => {
      const result = parseRdpFrame(Buffer.from(':'))
      expect(result.parsedMessage).toBeUndefined()
      // separatorIndex < 1, so no parse attempt
    })
  })
})
