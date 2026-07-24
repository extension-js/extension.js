import {describe, expect, it} from 'vitest'

import {classifyAddonInstallFailure} from '../../run-firefox/rdp/remote-firefox/addons-install'

// Firefox answers a rejected install with an RDP reply object carrying its own
// text; transport trouble arrives as an Error. Only the former is a verdict.
describe('classifyAddonInstallFailure (§85)', () => {
  it("carries Gecko's own rejection text as the reason", () => {
    const reply = {
      from: 'server1.conn0.addonsActor2',
      error: 'Error',
      message:
        "Could not install add-on at '/dist/firefox': Error: Extension is invalid\n" +
        'Reading manifest: Error processing browser_specific_settings.gecko.id'
    }

    expect(classifyAddonInstallFailure(reply)).toEqual({
      status: 'refused',
      reason: reply.message
    })
  })

  // 'unknown' is not a yes and it is not a no: a dead socket says nothing
  // about the add-on, so it must never be reported as a refusal.
  it('treats a transport failure as unknown, never a refusal', () => {
    expect(
      classifyAddonInstallFailure(new Error('RDP request timed out'))
    ).toEqual({status: 'unknown'})
  })

  it('treats a reply with no error field as unknown', () => {
    expect(
      classifyAddonInstallFailure({from: 'root', addon: {id: 'x'}})
    ).toEqual({status: 'unknown'})
  })

  it('treats an error reply with no message as unknown', () => {
    expect(
      classifyAddonInstallFailure({error: 'Error', message: '  '})
    ).toEqual({
      status: 'unknown'
    })
  })

  it('survives a null or primitive rejection value', () => {
    expect(classifyAddonInstallFailure(null)).toEqual({status: 'unknown'})
    expect(classifyAddonInstallFailure('boom')).toEqual({status: 'unknown'})
  })
})
