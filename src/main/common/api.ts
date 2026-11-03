import {
  BrowserWindow,
  ipcMain,
  dialog,
  app,
  Notification,
  nativeImage,
  clipboard,
  screen,
  shell,
} from 'electron';
import fs from 'fs';
import { screenCapture } from '@/core';
import plist from 'plist';
import ks from 'node-key-sender';

import {
  DECODE_KEY,
  PLUGIN_INSTALL_DIR as baseDir,
} from '@/common/constans/main';
import getCopyFiles from '@/common/utils/getCopyFiles';
import common from '@/common/utils/commonConst';

import mainInstance from '../index';
import { runner, detach } from '../browsers';
import DBInstance from './db';
import getWinPosition from './getWinPosition';
import path from 'path';
import commonConst from '@/common/utils/commonConst';
import { copyFilesToWindowsClipboard } from './windowsClipboard';

/**
 *  sanitize input files 剪贴板文件合法性校验
 * @param input
 * @returns
 */
const sanitizeInputFiles = (input: unknown): string[] => {
  const candidates = Array.isArray(input)
    ? input
    : typeof input === 'string'
    ? [input]
    : [];
  return candidates
    .map((filePath) => (typeof filePath === 'string' ? filePath.trim() : ''))
    .filter((filePath) => {
      if (!filePath) return false;
      try {
        return fs.existsSync(filePath);
      } catch {
        return false;
      }
    });
};

const runnerInstance = runner();
const detachInstance = detach();

class API extends DBInstance {
  init(mainWindow: BrowserWindow) {
    // 响应 preload.js 事件
    ipcMain.on('msg-trigger', async (event, arg) => {
      const window = arg.winId ? BrowserWindow.fromId(arg.winId) : mainWindow;
      const data = await this[arg.type](arg, window, event);
      event.returnValue = data;
      // event.sender.send(`msg-back-${arg.type}`, data);
    });
    // 异步通道：sendSync 无法正确返回 async handler 的结果（returnValue 在
    // await 让出后才被赋值，调用方早已拿到 undefined），故单独提供 invoke 通道
    ipcMain.handle('msg-trigger-async', async (event, arg) => {
      const window = arg.winId ? BrowserWindow.fromId(arg.winId) : mainWindow;
      return await this[arg.type](arg, window, event);
    });
    // 按 ESC 退出插件
    mainWindow.webContents.on('before-input-event', (event, input) =>
      this.__EscapeKeyDown(event, input, mainWindow)
    );
    // 设置主窗口的 show/hide 事件监听
    this.setupMainWindowHooks(mainWindow);
  }

  private setupMainWindowHooks(mainWindow: BrowserWindow) {
    mainWindow.on('show', () => {
      // 触发插件的 onShow hook
      runnerInstance.executeHooks('Show', null);
    });

    mainWindow.on('hide', () => {
      // 触发插件的 onHide hook
      runnerInstance.executeHooks('Hide', null);
    });
  }

  public getCurrentWindow = (window, e) => {
    let originWindow = BrowserWindow.fromWebContents(e.sender);
    if (originWindow !== window) originWindow = detachInstance.getWindow();
    return originWindow;
  };

  public __EscapeKeyDown = (event, input, window) => {
    if (input.type !== 'keyDown') return;
    if (!(input.meta || input.control || input.shift || input.alt)) {
      if (input.key === 'Escape') {
        if (this.currentPlugin) {
          this.removePlugin(null, window);
        } else {
          mainInstance.windowCreator.getWindow().hide();
        }
      }

      return;
    }
  };

  public windowMoving({ data: { mouseX, mouseY, width, height } }, window, e) {
    const { x, y } = screen.getCursorScreenPoint();
    const originWindow = this.getCurrentWindow(window, e);
    if (!originWindow) return;
    originWindow.setBounds({ x: x - mouseX, y: y - mouseY, width, height });
    getWinPosition.setPosition(x - mouseX, y - mouseY);
  }

  public loadPlugin({ data: plugin }, window) {
    window.webContents.executeJavaScript(
      `window.loadPlugin(${JSON.stringify(plugin)})`
    );
    this.openPlugin({ data: plugin }, window);
  }

  public openPlugin({ data: plugin }, window) {
    if (plugin.platform && !plugin.platform.includes(process.platform)) {
      return new Notification({
        title: `插件不支持当前 ${process.platform} 系统`,
        body: `插件仅支持 ${plugin.platform.join(',')}`,
        icon: plugin.logo,
      }).show();
    }
    window.setSize(window.getSize()[0], 60);
    this.removePlugin(null, window);
    // 模板文件
    if (!plugin.main) {
      plugin.tplPath = common.dev()
        ? 'http://localhost:8083/#/'
        : `file://${__static}/tpl/index.html`;
    }
    if (plugin.name === 'rubick-system-feature') {
      plugin.logo = plugin.logo || `file://${__static}/logo.png`;
      plugin.indexPath = commonConst.dev()
        ? 'http://localhost:8081/#/'
        : `file://${__static}/feature/index.html`;
    } else if (!plugin.indexPath) {
      const pluginPath = path.resolve(baseDir, 'node_modules', plugin.name);
      plugin.indexPath = `file://${path.join(
        pluginPath,
        './',
        plugin.main || ''
      )}`;
    }
    runnerInstance.init(plugin, window);
    this.currentPlugin = plugin;
    window.webContents.executeJavaScript(
      `window.setCurrentPlugin(${JSON.stringify({
        currentPlugin: this.currentPlugin,
      })})`
    );
    window.show();
    const view = runnerInstance.getView();
    if (!view.inited) {
      view.webContents.on('before-input-event', (event, input) =>
        this.__EscapeKeyDown(event, input, window)
      );
    }
  }

  public removePlugin(e, window) {
    runnerInstance.removeView(window);
    this.currentPlugin = null;
  }

  public openPluginDevTools() {
    runnerInstance.getView().webContents.openDevTools({ mode: 'detach' });
  }

  public hideMainWindow(arg, window) {
    window.hide();
  }

  public showMainWindow(arg, window) {
    window.show();
  }

  public showOpenDialog({ data }, window) {
    return dialog.showOpenDialogSync(window, data);
  }

  public showSaveDialog({ data }, window) {
    return dialog.showSaveDialogSync(window, data);
  }

  public setExpendHeight({ data: height }, window: BrowserWindow, e) {
    const originWindow = this.getCurrentWindow(window, e);
    if (!originWindow) return;
    const targetHeight = height;
    originWindow.setSize(originWindow.getSize()[0], targetHeight);
    const screenPoint = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(screenPoint);
    const position =
      originWindow.getPosition()[1] + targetHeight > display.bounds.height
        ? height - 60
        : 0;
    originWindow.webContents.executeJavaScript(
      `window.setPosition && typeof window.setPosition === "function" && window.setPosition(${position})`
    );
  }

  public setSubInput({ data }, window, e) {
    const originWindow = this.getCurrentWindow(window, e);
    if (!originWindow) return;
    originWindow.webContents.executeJavaScript(
      `window.setSubInput(${JSON.stringify({
        placeholder: data.placeholder,
      })})`
    );
  }

  public subInputBlur() {
    runnerInstance.getView().webContents.focus();
  }

  public sendSubInputChangeEvent({ data }) {
    runnerInstance.executeHooks('SubInputChange', data);
  }

  public removeSubInput(data, window, e) {
    const originWindow = this.getCurrentWindow(window, e);
    if (!originWindow) return;
    originWindow.webContents.executeJavaScript(`window.removeSubInput()`);
  }

  public setSubInputValue({ data }, window, e) {
    const originWindow = this.getCurrentWindow(window, e);
    if (!originWindow) return;
    originWindow.webContents.executeJavaScript(
      `window.setSubInputValue(${JSON.stringify({
        value: data.text,
      })})`
    );
    this.sendSubInputChangeEvent({ data });
  }

  public getPath({ data }) {
    return app.getPath(data.name);
  }

  /**
   * 切换主窗口背景（液态玻璃主题）。
   * 采用纯 CSS 方案：窗口始终不透明，玻璃质感完全由渲染层绘制，
   * 这里只负责同步窗口底色，避免启动瞬间或降级时露出白色底。
   */
  public setWindowMaterial({ data }, window: BrowserWindow) {
    const win: any = window;
    if (!win) return false;
    const glass = !!data?.glass;
    try {
      if (typeof win.setBackgroundMaterial === 'function') {
        win.setBackgroundMaterial('none');
      }
      win.setBackgroundColor(glass ? '#0b1020' : '#1c1c28');
      return true;
    } catch (e) {
      return false;
    }
  }

  public showNotification({ data: { body } }) {
    if (!Notification.isSupported()) return;
    'string' != typeof body && (body = String(body));
    const plugin = this.currentPlugin;
    const notify = new Notification({
      title: plugin ? plugin.pluginName : null,
      body,
      icon: plugin ? plugin.logo : null,
    });
    notify.show();
  }

  public copyImage = ({ data }) => {
    const image = nativeImage.createFromDataURL(data.img);
    clipboard.writeImage(image);
  };

  public copyText({ data }) {
    clipboard.writeText(String(data.text));
    return true;
  }

  public copyFile({ data }) {
    const targetFiles = sanitizeInputFiles(data?.file);

    if (!targetFiles.length) {
      return false;
    }

    if (process.platform === 'darwin') {
      try {
        clipboard.writeBuffer(
          'NSFilenamesPboardType',
          Buffer.from(plist.build(targetFiles))
        );
        return true;
      } catch {
        return false;
      }
    }

    if (process.platform === 'win32') {
      return copyFilesToWindowsClipboard(targetFiles);
    }

    return false;
  }

  public getFeatures() {
    return this.currentPlugin?.features;
  }

  public setFeature({ data }, window) {
    this.currentPlugin = {
      ...this.currentPlugin,
      features: (() => {
        let has = false;
        this.currentPlugin.features.some((feature) => {
          has = feature.code === data.feature.code;
          return has;
        });
        if (!has) {
          return [...this.currentPlugin.features, data.feature];
        }
        return this.currentPlugin.features;
      })(),
    };
    window.webContents.executeJavaScript(
      `window.updatePlugin(${JSON.stringify({
        currentPlugin: this.currentPlugin,
      })})`
    );
    return true;
  }

  public removeFeature({ data }, window) {
    this.currentPlugin = {
      ...this.currentPlugin,
      features: this.currentPlugin.features.filter((feature) => {
        if (data.code.type) {
          return feature.code.type !== data.code.type;
        }
        return feature.code !== data.code;
      }),
    };
    window.webContents.executeJavaScript(
      `window.updatePlugin(${JSON.stringify({
        currentPlugin: this.currentPlugin,
      })})`
    );
    return true;
  }

  public sendPluginSomeKeyDownEvent({ data: { modifiers, keyCode } }) {
    const code = DECODE_KEY[keyCode];
    if (!code || !runnerInstance.getView()) return;
    if (modifiers.length > 0) {
      runnerInstance.getView().webContents.sendInputEvent({
        type: 'keyDown',
        modifiers,
        keyCode: code,
      });
    } else {
      runnerInstance.getView().webContents.sendInputEvent({
        type: 'keyDown',
        keyCode: code,
      });
    }
  }

  public detachPlugin(e, window) {
    if (!this.currentPlugin) return;
    const view = window.getBrowserView();
    window.setBrowserView(null);
    window.webContents
      .executeJavaScript(`window.getMainInputInfo()`)
      .then((res) => {
        detachInstance.init(
          {
            ...this.currentPlugin,
            subInput: res,
          },
          window.getBounds(),
          view
        );
        window.webContents.executeJavaScript(`window.initRubick()`);
        window.setSize(window.getSize()[0], 60);
        this.currentPlugin = null;
      });
  }

  public detachInputChange({ data }) {
    this.sendSubInputChangeEvent({ data });
  }

  public getLocalId() {
    return encodeURIComponent(app.getPath('home'));
  }

  public shellShowItemInFolder({ data }) {
    shell.showItemInFolder(data.path);
    return true;
  }

  private iconCache = new Map<string, string | null>();

  /**
   * 取单个文件/应用图标，返回 dataURL。
   *
   * 背景：Electron 的 app.getFileIcon 在 Windows 上对相当一部分 exe
   * 会返回同一张「空白文档」占位图（实测 40 个不同应用返回完全相同的
   * dataURL），因此不能只依赖它，改为系统提取优先、Electron 兜底。
   */
  public async getFileIcon({ data }) {
    const target = data?.path;
    const batch = this.batchGetFileIcons({ data: { paths: [target] } });
    if (batch[target]) return batch[target];
    try {
      const nativeImage = await app.getFileIcon(target, { size: 'normal' });
      return nativeImage.toDataURL();
    } catch (e) {
      return '';
    }
  }

  /**
   * 批量取应用图标（Windows）。
   * 逐个起 PowerShell 太慢（150+ 应用约 40s），改为一次进程内循环提取。
   *
   * @param paths exe 路径数组
   * @returns { [path]: dataURL }，取不到的不返回
   */
  public batchGetFileIcons({ data }) {
    const paths: string[] = Array.isArray(data?.paths) ? data.paths : [];
    const result: Record<string, string> = {};
    if (!paths.length) return result;
    // 先查缓存
    const pending: string[] = [];
    for (const p of paths) {
      if (this.iconCache.has(p)) {
        const hit = this.iconCache.get(p);
        if (hit) result[p] = hit;
      } else {
        pending.push(p);
      }
    }
    if (!pending.length) return result;

    if (process.platform !== 'win32') return result;

    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { execFileSync } = require('child_process');
      const outDir = app.getPath('temp');
      const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const outFile = path.join(outDir, `rubick-icons-${stamp}.json`);

      // 把路径写成 JSON 传参，避免拼字符串转义出错
      const inputFile = path.join(outDir, `rubick-icons-${stamp}-in.json`);
      fs.writeFileSync(inputFile, JSON.stringify(pending), 'utf8');

      const script = [
        'Add-Type -AssemblyName System.Drawing',
        '$paths = Get-Content -Raw -Encoding UTF8 ' +
          `'${inputFile.replace(/'/g, "''")}'` +
          ' | ConvertFrom-Json',
        '$out = @{}',
        'foreach ($p in $paths) {',
        '  try {',
        '    $i = [System.Drawing.Icon]::ExtractAssociatedIcon($p)',
        '    if ($i) {',
        '      $ms = New-Object System.IO.MemoryStream',
        '      $i.ToBitmap().Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)',
        '      $out[$p] = [Convert]::ToBase64String($ms.ToArray())',
        '      $ms.Dispose()',
        '      $i.Dispose()',
        '    }',
        '  } catch {}',
        '}',
        '$out | ConvertTo-Json -Compress | Set-Content -Encoding UTF8 ' +
          `'${outFile.replace(/'/g, "''")}'`,
      ].join(';');

      execFileSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', script],
        { timeout: 60000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }
      );

      let parsed: any = {};
      try {
        if (fs.existsSync(outFile)) {
          // PowerShell 的 Set-Content -Encoding UTF8 会写入 BOM，
          // 直接 JSON.parse 会失败，需先剥离
          const raw = fs.readFileSync(outFile, 'utf8').replace(/^\uFEFF/, '');
          parsed = JSON.parse(raw) || {};
        }
      } catch (e) {
        parsed = {};
      }

      for (const p of pending) {
        const b64 = parsed[p];
        const url = b64 ? `data:image/png;base64,${b64}` : null;
        this.iconCache.set(p, url);
        if (url) result[p] = url;
      }

      // 清理临时文件
      for (const f of [inputFile, outFile]) {
        try {
          fs.existsSync(f) && fs.unlinkSync(f);
        } catch (e) {
          //
        }
      }
    } catch (e) {
      // 批量失败则该批不填，前台会用 Electron 兜底
    }
    return result;
  }

  /**
   * Windows：用 System.Drawing 提取关联图标，返回 PNG dataURL。
   * 通过 PowerShell 调用，避免引入额外原生依赖。
   */
  private extractIconFromWindows(filePath: string): string | null {
    if (process.platform !== 'win32' || !filePath) return null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { execFileSync } = require('child_process');
      const tmp = path.join(
        app.getPath('temp'),
        `rubick-icon-${Date.now()}-${Math.random().toString(36).slice(2)}.png`
      );
      const escaped = filePath.replace(/'/g, "''");
      const outEscaped = tmp.replace(/'/g, "''");
      const script = [
        'Add-Type -AssemblyName System.Drawing',
        `$i=[System.Drawing.Icon]::ExtractAssociatedIcon('${escaped}')`,
        'if($i){$b=$i.ToBitmap();$b.Save(\'' + outEscaped + '\',[System.Drawing.Imaging.ImageFormat]::Png);$b.Dispose();$i.Dispose()}',
      ].join(';');
      execFileSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', script],
        { timeout: 8000, windowsHide: true }
      );
      if (!fs.existsSync(tmp)) return null;
      const buf = fs.readFileSync(tmp);
      try {
        fs.unlinkSync(tmp);
      } catch (e) {
        //
      }
      if (!buf.length) return null;
      return `data:image/png;base64,${buf.toString('base64')}`;
    } catch (e) {
      return null;
    }
  }

  public shellBeep() {
    shell.beep();
    return true;
  }

  public screenCapture(arg, window) {
    screenCapture(window, (img) => {
      runnerInstance.executeHooks('ScreenCapture', {
        data: img,
      });
    });
  }

  public getCopyFiles() {
    return getCopyFiles();
  }

  public simulateKeyboardTap({ data: { key, modifier } }) {
    let keys = [key.toLowerCase()];
    if (modifier && Array.isArray(modifier) && modifier.length > 0) {
      keys = modifier.concat(keys);
      ks.sendCombination(keys);
    } else {
      ks.sendKeys(keys);
    }
  }

  public addLocalStartPlugin({ data: { plugin } }, window) {
    window.webContents.executeJavaScript(
      `window.addLocalStartPlugin(${JSON.stringify({
        plugin,
      })})`
    );
  }

  public removeLocalStartPlugin({ data: { plugin } }, window) {
    window.webContents.executeJavaScript(
      `window.removeLocalStartPlugin(${JSON.stringify({
        plugin,
      })})`
    );
  }
}

export default new API();
