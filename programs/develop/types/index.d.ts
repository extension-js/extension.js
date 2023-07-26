/// <reference types="node" />
/// <reference types="react" />
/// <reference types="react-dom" />
/// <reference types="chrome" />
/// <reference path="./css-modules.d.ts" />
/// <reference path="./images.d.ts" />

declare namespace NodeJS {
  interface ProcessEnv {
    readonly EXTENSION_ENV: 'development' | 'production' | 'test' | 'debug'
  }
}
