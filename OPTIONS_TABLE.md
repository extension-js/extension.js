# Program Options Table

[extension-create](https://github.com/cezaraugusto/extension-create) comes with a set of commands that can be customized with options.

- [create](#create-command) - creates an extension
- [dev](#dev-command) - bundle the extension in a browser and runs the extension in development mode
- [start](#start-command) - bundle the extension in a browser and runs the extension in production mode
- [build](#build-command) - bundle the extension in production mode

### Create Command

```
yarn extension-create [options]
```

**Responsible for creating extensions.** If provided, a custom template can be used from an [npm](https://npmjs.org) package. Otherwise, a native template (one of "web", "react", "react-typescript", or "react") will be used. Defaults to "web".

Users can also opt for a different directory to install their extensions. Defaults to `process.cwd()`.

| Flag           | Argument                                                | What it does                                        | Defaults to   |
| -------------- | ------------------------------------------------------- | --------------------------------------------------- | ------------- |
| -t, --template | Name of the template used to bootstrap your extension   | Bootstrap your extension using a template           | web           |
| --working-dir  | Path to the directory where the project will be created | Sets the working directory to install the extension | process.cwd() |

### Dev Command

```
yarn extension-create dev [url] [options]
```

**Responsible for all development tasks .** Gets the extension and bundles in a new browser instance. Browser extension files are watched and live-reloaded as they change.

If a URL is provided, `extension-create` will download and run the extension in the current working directory and follow the same tasks any other local extension would.

The target browser can be set to determine which browser they want to run their extension. Setting it to "all" would open all browsers at once. User must have the browser of choice installed.

Users can also opt for a different port to run their extensions. Defaults to `:8888`.

| Flag          | Argument                                | What it does                                  | Defaults to |
| ------------- | --------------------------------------- | --------------------------------------------- | ----------- |
| [url]         | Optional URL to an extension path       | Downloads and run the extension path          | None        |
| -p, --port    | The port used to serve watched files    | Changes the port for the "dev" script         | 8888        |
| -b, --browser | The browser that will run the extension | Changes the browser (`chrome`, `edge`, `all`) | 'chrome'    |

<!--
| Flag                | Argument                    | What it does                                                                                                                          |
| ------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| -o, --open          | boolean                     | Whether to open the browser. This invalidates the `--user-data-dir` flag. Defaults to `true`.                                         |
| -u, --user-data-dir | file path or boolan         | What browser profile path to use. A boolean value of false sets the profile to the default user profile. Defaults to a fresh profile. |
| -b, --browser       | 'chrome' or 'edge' or 'all' | Which browser to target your extension build. Defaults to `'chrome'`.                                                                 |
| -p, --polyfill      | boolean                     | Whether or not to apply the cross-browser polyfill. Defaults to `true`.                                                               |
| -a, --auto-reload   | boolean                     | Whether to enable auto-reload on save. Defaults to `true`.                                                                            |
| -p, --port          | number                      | What port should extension-create/develop run. Defaults to `3000`.                                                                    |
| -r, --reloader-port | number                      | What port should run the reloader run. Defaults to `8081`.
-->

### Start Command

```
yarn extension-create dev [options]
```

**Responsible for live-viewing the extension in production mode.** Builds the extension for production and bundles in a new browser instance. You get what users get. Files are not hot-reloaded.

If a URL is provided, `extension-create` will download and run the extension in the current working directory and follow the same tasks any other local extension would.

The target browser can be set to determine which browser they want to run their extension. Setting it to "all" would open all browsers at once. User must have the browser of choice installed.

Users can also opt for a different port to run their extensions. Defaults to `:8889`.

| Flag          | Argument                                | What it does                                  | Defaults to |
| ------------- | --------------------------------------- | --------------------------------------------- | ----------- |
| [url]         | Optional URL to an extension path       | Downloads and run the extension path          | None        |
| -p, --port    | The port used to serve watched files    | Changes the port for the "dev" script         | 8888        |
| -b, --browser | The browser that will run the extension | Changes the browser (`chrome`, `edge`, `all`) | 'chrome'    |

### Build Command

```
yarn extension-create dev [options]
```

**Responsible for building the extension in production mode.** Builds the extension for production, based on the browser choice. The `build/` folder will include as many subfolders as the user browser choices. Each subfolder includes the code for that specific browser, with proper code transforms for each platform.

Users can also opt for a different port to run their extensions. Defaults to `:8889`.

| Flag          | Argument                                           | What it does                                     | Defaults to |
| ------------- | -------------------------------------------------- | ------------------------------------------------ | ----------- |
| -b, --browser | The browser will set the extension bundle defaults | Changes the output code to the browser of choice | 'chrome'    |
