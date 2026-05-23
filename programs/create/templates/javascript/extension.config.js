/** @type {import('extension').FileConfig} */
// Extension.js uses a fresh profile on every run.
// Prefer that default? Remove the profile config below.
const profile = (name) => `./dist/extension-profile-${name}`
const ciFlags = process.env.CI ? ['--no-sandbox', '--disable-gpu'] : []

export default {
  browser: {
    chrome: {profile: profile('chrome'), browserFlags: ciFlags},
    chromium: {profile: profile('chromium'), browserFlags: ciFlags},
    edge: {profile: profile('edge'), browserFlags: ciFlags},
    firefox: {profile: profile('firefox')},
    'chromium-based': {
      profile: profile('chromium-based'),
      browserFlags: ciFlags
    },
    'gecko-based': {profile: profile('gecko-based')}
  }
}
