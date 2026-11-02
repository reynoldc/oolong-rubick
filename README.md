# oolong-rubick

<div align="center">
  <img align="center" width=200 src="./public/logo.png" />
</div>

## What is this

This project is a **fork / secondary development** based on the open-source [Rubick](https://github.com/rubickCenter/rubick).

Rubick is a pluggable desktop productivity toolbox (uTools-style). Plugins are installed and uninstalled as npm packages, and plugin data can be synced across devices via webdav. Rubick also supports private network deployment. This branch builds on top of it with custom enhancements focused on the **main window startup experience**.

## Credits

All core capabilities come from the original author [muwoo](https://github.com/muwoo) and the [rubickCenter](https://github.com/rubickCenter) community.

- Upstream repository: https://github.com/rubickCenter/rubick
- Website: https://rubick.vip
- Docs: https://rubickCenter.github.io/rubick/

This project follows the upstream [MIT License](./LICENSE). The work here is an incremental layer on top of the main window interaction only — full credit for the original design and implementation belongs to the upstream authors. Thanks for sharing it with the community.

## What's new in this fork

### 1. Quick Launch panel

When the main window opens (default hotkey `Alt/Option + R`), a quick launch panel appears below the search bar with two sections:

- **Recent**: local applications previously launched via search, ordered by most recent use, ready for one-click relaunch.
- **Favorites**: a user-editable list of applications. Click the `+` on the section header to search and add from locally installed apps; right-click an icon to remove it.

Data is stored in PouchDB under `rubick-plugin-history` (recent) and `rubick-favorite-apps` (favorites).

### 2. Arrow-key selection

The upstream behavior is preserved: the first item is selected by default when the panel opens. `Up`/`Down` moves the cursor continuously across "Recent" then "Favorites", wrapping around at the ends. `Enter` or Space launches the highlighted item.

### 3. Fixed missing application icons

On Windows, icons for local applications were largely blank in upstream. Two independent causes were fixed:

- **Unusable native module**: the original code relied on `extract-file-icon`, a native module whose `addon.node` is never packed into `app.asar`, so every call failed silently after packaging. It now uses the main process `app.getFileIcon()` over an async IPC channel — no native dependency.
- **Filename / protocol decoding mismatch**: icon files were written using `encodeURIComponent`-encoded names, while the `image://` protocol handler performs `decodeURI()`, so lookups pointed at non-existent files. Plain ASCII app names happened to work; Chinese names and names with spaces were always blank. Names are now consistent (with sanitization of Windows-illegal filename characters).

Additionally, the original scan function `fileDisplay` recursed asynchronously but returned synchronously, so icons were not yet written on first run. It is now Promise-based with concurrency control (8 concurrent, 3s per-icon timeout, 8s overall timeout) so it never blocks window startup.

## Usage

After installation, press `Alt/Option + R` to bring up the main window. Type a keyword to search apps, plugins, and files. Click the logo on the left to open the plugin market.

For plugin development and detailed usage, see the [Rubick documentation](https://rubickCenter.github.io/rubick/).

## Build

Node 16 is recommended (the project pins `16.20.2` via volta). On newer Node, extra env vars are required:

```bash
# Needed on Node 17+ (webpack 4 OpenSSL compatibility)
export NODE_OPTIONS=--openssl-legacy-provider
# Specify VS version when compiling native modules on Windows
export npm_config_msvs_version=2022

yarn install --ignore-engines
yarn run electron:build --win --x64
```

Artifacts are written to `build/`.

> Note: this branch builds x64 only. The upstream win config also listed ia32, which fails because `electron-clipboard-ex` has no usable ia32 artifact.

## Layout

```
src/
├── main/           Electron main process: window factories, plugin API bus, hotkeys, tray
├── renderer/       Renderer process: search UI + plugin orchestration
│   └── components/quick-launch.vue   new: quick launch panel
├── core/           Cross-platform core: plugin install, PouchDB, local app search, screenshot
└── common/         Shared constants and utils
feature/            Built-in system plugin: market, installed, account, settings, developer
```

## License

[MIT](./LICENSE) — inherited from upstream [Rubick](https://github.com/rubickCenter/rubick).
