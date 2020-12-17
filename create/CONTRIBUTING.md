# Contributing to @webextension/create

## Getting started

```
git clone git@github.com:cezaraugusto/extension-create.git
cd extension-create/create
yarn install
```

## Creating an extension

`yarn dev:create` is equivalent of running `npx @webextension/create my-hello-extension`

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
