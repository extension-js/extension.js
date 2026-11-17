import {describe, expect, it} from 'vitest'

import {
  addonRefusalOnOneLine,
  classifyAddonInstallFailure
} from '../../run-firefox/rdp/remote-firefox/addons-install'

// Firefox answers a rejected install with an RDP reply object carrying its own
// text; transport trouble arrives as an Error. Only the former is a verdict.
describe('classifyAddonInstallFailure', () => {
  it("carries Gecko's own rejection text as the reason", () => {
    const reply = {
      from: 'server1.conn0.addonsActor2',
      error: 'Error',
      message:
        "Could not install add-on at '/dist/firefox': Error: Extension is invalid\n" +
        'Reading manifest: Error processing browser_specific_settings.gecko.id'
    }

    // Gecko's words on one line, without the folder every surface already
    // prints beside the reason.
    expect(classifyAddonInstallFailure(reply)).toEqual({
      status: 'refused',
      reason:
        'Could not install add-on: Error: Extension is invalid ' +
        'Reading manifest: Error processing browser_specific_settings.gecko.id'
    })
  })

  it('leaves a reason that names no folder as the browser wrote it', () => {
    expect(addonRefusalOnOneLine("  It's   refused:\n\tbad 'value'  ")).toBe(
      "It's refused: bad 'value'"
    )

    expect(
      addonRefusalOnOneLine(
        "Could not install add-on at '/it's here/dist': Error: x 'y': z"
      )
    ).toBe("Could not install add-on: Error: x 'y': z")
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
