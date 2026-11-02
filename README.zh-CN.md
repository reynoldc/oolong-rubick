# oolong-rubick

<div align="center">
  <img align="center" width=200 src="./public/logo.png" />
</div>

## 这是什么

本项目是基于开源项目 [Rubick](https://github.com/rubickCenter/rubick) 的**二次开发版本**。

Rubick 是一个插件化的桌面效率工具箱（uTools 风格），插件以 npm 包形式安装卸载，支持 webdav 多端数据同步与内网部署。本分支在其基础上，针对**主窗口启动体验**做了定制增强。

## 致谢

本项目全部核心能力来自 Rubick 原作者 [muwoo](https://github.com/muwoo) 及 [rubickCenter](https://github.com/rubickCenter) 社区的开源贡献。

- 上游仓库：https://github.com/rubickCenter/rubick
- 官网：https://rubick.vip
- 文档：https://rubickCenter.github.io/rubick/

本项目遵循上游的 [MIT License](./LICENSE)，仅在主窗口交互层做了增量开发，绝无冒认原创之意。感谢原作者的无私分享。

## 本分支新增功能

### 1. 快速启动面板

打开主窗口（默认快捷键 `Alt/Option + R`）后，搜索栏下方新增一个快速启动面板，包含两个区块：

- **最近使用**：自动记录通过搜索启动过的本机应用，按最近使用排序，方便一键再次启动。
- **我的收藏**：可自定义编辑的应用列表。点击区块标题右侧的 `+` 从本机已安装应用中搜索添加；右键图标可移除。

数据分别存放在 PouchDB 的 `rubick-plugin-history`（最近使用）与 `rubick-favorite-apps`（我的收藏）中。

### 2. 方向键快捷选择

保持原版规则：打开面板后默认选中第一项，按 `↑`/`↓` 在「最近使用 → 我的收藏」之间连续移动光标，越界自动回绕，按 `Enter` 或空格直接启动选中项。

### 3. 修复应用图标不显示

原版在 Windows 下本机应用图标大面积空白，本分支修复了该问题，涉及两个独立成因：

- **原生模块不可用**：原实现依赖 `extract-file-icon`（需要本地编译的原生模块），其 `addon.node` 不会被打进 `app.asar`，打包后调用必然失败且被静默吞掉。改为调用主进程 `app.getFileIcon()`，经异步 IPC 通道取回图标，无原生依赖。
- **文件名与协议解码不匹配**：图标文件以 `encodeURIComponent` 后的名字写盘，而 `image://` 协议处理器会执行 `decodeURI()`，导致读取时指向不存在的文件——纯英文应用名恰好能显示，中文名与带空格的名字全部空白。现统一使用原应用名（并对 Windows 非法文件名字符做清洗）。

此外原扫描函数 `fileDisplay` 是异步递归但同步返回，首次运行时图标尚未写入就被返回；现已改为 Promise 化并加入并发控制（并发 8、单个超时 3s、整体超时 8s），不阻塞主窗口启动。

## 使用

安装后按 `Alt/Option + R` 呼出主程序，输入关键词可搜索应用、插件、文件。点击左侧 logo 进入插件市场。

详细的插件开发与使用说明请参考 [Rubick 官方文档](https://rubickCenter.github.io/rubick/)。

## 构建

需要 Node 16（项目 volta 锁定 `16.20.2`）。若在更高版本 Node 上构建，需额外设置环境变量：

```bash
# Node 17+ 需要（webpack 4 的 OpenSSL 兼容）
export NODE_OPTIONS=--openssl-legacy-provider
# Windows 编译原生模块时指定 VS 版本
export npm_config_msvs_version=2022

yarn install --ignore-engines
yarn run electron:build --win --x64
```

构建产物输出在 `build/` 目录。

> 注意：本分支仅构建 x64 安装包（原版 win 配置含 ia32，其 `electron-clipboard-ex` 无可用产物会导致打包中断）。

## 目录结构简述

```
src/
├── main/           Electron 主进程：窗口工厂、插件 API 总线、快捷键与托盘
├── renderer/       渲染进程：搜索主界面 + 插件调度
│   └── components/quick-launch.vue   新增：快速启动面板
├── core/           跨平台核心：插件安装、PouchDB、本机应用搜索、截图
└── common/         共享常量与工具
feature/            内置系统插件：插件市场、已安装、账户、设置、开发者
```

## License

[MIT](./LICENSE) —— 继承自上游 [Rubick](https://github.com/rubickCenter/rubick)。
