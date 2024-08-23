import {Configuration} from '@rspack/core'

export interface FileConfig {
  config: (config: Configuration) => Configuration
}
