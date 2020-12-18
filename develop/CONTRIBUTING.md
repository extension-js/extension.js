# Contributing to @webextension/start

## Getting started

```
git clone git@github.com:cezaraugusto/extension-create.git
cd extension-create/develop/start
yarn install
```

## Creating an extension

`yarn dev:start my-hello-extension` is equivalent of running `npx @webextension/start my-hello-extension`

## Running tests

`cli.test.js` is an evergrowing list of tests covering functionalities exposed to the client. For file testing, see **unit testing**.

```
yarn test
```

### Unit testing

Unit tests are welcome and should live in the same folder as the file it is testing, having one created in case of no tests, suffixed with `.test.js`.

For example:

**Before**

```
folder/
  method1.js
  method2.js
  method3.js
```

**After**

```
folder/
  method1/
    method1.js
    method1.spec.js
  method2.js
  method3.js
```
