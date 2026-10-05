import {describe} from 'vitest'
import {geckoSystemProfileSpecs} from './gecko-system-profile'

// The stand-in browser is a shell script.
describe.skipIf(process.platform === 'win32')(
  'dev on a Gecko browser in system profile mode',
  () => geckoSystemProfileSpecs('dev')
)
