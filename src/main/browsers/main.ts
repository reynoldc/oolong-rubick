import { app, BrowserWindow, protocol, nativeTheme } from 'electron';
import path from 'path';
import os from 'os';
import { createProtocol } from 'vue-cli-plugin-electron-builder/lib';
// import versonHandler from '../common/versionHandler';
import localConfig from '@/main/common/initLocalConfig';
import {
  WINDOW_HEIGHT,
  WINDOW_MIN_HEIGHT,
  WINDOW_WIDTH,
} from '@/common/constans/common';
// eslint-disable-next-line @typescript-eslint/no-var-requires
require('@electron/remote/main').initialize();

// 判断当前系统是否支持 acrylic（仅 Windows 11 起提供该材质）
const isWin11OrLater = (): boolean => {
  if (process.platform !== 'win32') return false;
  try {
    const [major, minor, build] = os.release().split('.').map(Number);
    // Windows 11 起 NT 版本号为 10.0.22000+
    return major > 10 || (major === 10 && build >= 22000);
  } catch (e) {
    return false;
  }
};

// 液态玻璃主题需要窗口透明以透出系统毛玻璃材质。
// 窗口的 transparent 只能在创建时设定，而窗口创建前无法同步读 DB，
// 故由主进程在 ready 阶段读取配置后调用 setInitialConfig 注入。
let initialConfig: any = null;

export const setInitialConfig = (config: any) => {
  initialConfig = config;
};

export const isLiquidGlass = (config: any): boolean =>
  !!config && config.perf?.custom?.theme === 'LIQUID_GLASS';

const applyGlassMaterial = (win: any, config: any) => {
  if (!isLiquidGlass(config)) return;
  try {
    win.setBackgroundColor('#00000000');
    // Win11  acrylic 真·毛玻璃；Win10 无此 API，静默降级为 CSS 模拟
    if (typeof win.setBackgroundMaterial === 'function') {
      win.setBackgroundMaterial('acrylic');
    }
    // 透明窗口默认不可调整大小，需显式开启
    win.setResizable(true);
  } catch (e) {
    // 材质设置失败不影响启动，界面会退回 CSS 模拟效果
  }
};

export default () => {
  let win: any;

  const init = () => {
    createWindow();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('@electron/remote/main').enable(win.webContents);
  };

  const createWindow = async () => {
    // 使用 ready 阶段注入的配置（同步可得）。
    // 注意：此处绝不能 await —— init() 会在 createWindow() 之后同步访问
    // win.webContents，若 win 赋值被推迟到微任务之后会直接抛错。
    const glass = isLiquidGlass(initialConfig);
    win = new BrowserWindow({
      height: WINDOW_HEIGHT,
      minHeight: WINDOW_MIN_HEIGHT,
      useContentSize: true,
      resizable: true,
      width: WINDOW_WIDTH,
      frame: false,
      title: '拉比克',
      show: false,
      skipTaskbar: true,
      // 液态玻璃需透明窗口；否则沿用原有实色背景
      transparent: glass,
      backgroundColor: glass
        ? '#00000000'
        : nativeTheme.shouldUseDarkColors
        ? '#1c1c28'
        : '#fff',
      webPreferences: {
        webSecurity: false,
        backgroundThrottling: false,
        contextIsolation: false,
        webviewTag: true,
        nodeIntegration: true,
        preload: path.join(__static, 'preload.js'),
        spellcheck: false,
      },
    });
    // 窗口已就绪，同步应用玻璃材质（Win10 无 API 时内部静默降级）
    applyGlassMaterial(win, initialConfig);
    if (process.env.WEBPACK_DEV_SERVER_URL) {
      // Load the url of the dev server if in development mode
      win.loadURL(process.env.WEBPACK_DEV_SERVER_URL as string);
    } else {
      createProtocol('app');
      // Load the index.html when not in development
      win.loadURL('app://./index.html');
    }
    protocol.interceptFileProtocol('image', (req, callback) => {
      const url = req.url.substr(8);
      callback(decodeURI(url));
    });
    win.on('closed', () => {
      win = undefined;
    });

    win.on('show', () => {
      // 触发主窗口的 onShow hook
      win.webContents.executeJavaScript(
        `window.rubick && window.rubick.hooks && typeof window.rubick.hooks.onShow === "function" && window.rubick.hooks.onShow()`
      );
      // versonHandler.checkUpdate();
      // win.webContents.openDevTools();
    });

    win.on('hide', () => {
      // 触发主窗口的 onHide hook
      win.webContents.executeJavaScript(
        `window.rubick && window.rubick.hooks && typeof window.rubick.hooks.onHide === "function" && window.rubick.hooks.onHide()`
      );
    });

    // 判断失焦是否隐藏
    win.on('blur', async () => {
      const config = await localConfig.getConfig();
      if (config.perf.common.hideOnBlur) {
        win.hide();
      }
    });
  };

  const getWindow = () => win;

  return {
    init,
    getWindow,
  };
};
