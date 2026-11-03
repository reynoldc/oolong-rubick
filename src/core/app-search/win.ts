import fs from 'fs';
import path from 'path';
import os from 'os';
import { shell } from 'electron';

const filePath = path.resolve(
  'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs'
);

const appData = path.join(os.homedir(), './AppData/Roaming');

const startMenu = path.join(
  appData,
  'Microsoft\\Windows\\Start Menu\\Programs'
);

const fileLists: any = [];
const isZhRegex = /[\u4e00-\u9fa5]/;

const icondir = path.join(os.tmpdir(), 'ProcessIcon');
const exists = fs.existsSync(icondir);
if (!exists) {
  fs.mkdirSync(icondir);
}

// 图标缓存版本。取图逻辑变更时递增，使旧的缓存文件自动失效
// （旧版本缓存了 Electron 返回的通用占位图）。
const ICON_CACHE_VERSION = 3;
const versionFile = path.join(icondir, '.cache-version');
try {
  const current = fs.readFileSync(versionFile, 'utf8').trim();
  if (current !== String(ICON_CACHE_VERSION)) {
    // 版本不匹配：清空旧缓存图标
    for (const f of fs.readdirSync(icondir)) {
      if (f === '.cache-version') continue;
      try {
        fs.unlinkSync(path.join(icondir, f));
      } catch (e) {
        //
      }
    }
    fs.writeFileSync(versionFile, String(ICON_CACHE_VERSION));
  }
} catch (e) {
  // 无版本文件（首次运行或旧版本遗留）：清空并写入当前版本
  try {
    for (const f of fs.readdirSync(icondir)) {
      if (f === '.cache-version') continue;
      try {
        fs.unlinkSync(path.join(icondir, f));
      } catch (err) {
        //
      }
    }
    fs.writeFileSync(versionFile, String(ICON_CACHE_VERSION));
  } catch (err) {
    //
  }
}

// 同一路径只请求一次，避免重复 IPC
// 应用名可能含 Windows 非法文件名字符，需清洗；
// 注意不能用 encodeURIComponent——主进程 image:// 协议会 decodeURI，
// 编码后的文件名解码后找不到对应文件。
const safeIconName = (name: string): string =>
  name.replace(/[\\/:*?"<>|]/g, '_');

/**
 * 批量获取所有应用图标。
 *
 * 历史问题：
 * 1) extract-file-icon 是原生模块，addon.node 不会被打进 app.asar，打包后
 *    require 必然失败；
 * 2) 改用 app.getFileIcon 后，实测发现 Windows 上它对相当一部分 exe
 *    返回同一张「空白文档」占位图（40 个不同应用返回完全相同的 dataURL），
 *    导致大量图标错误；
 * 3) 用 image:// 协议读临时文件时，路径含空格/中文会解析失败。
 *
 * 最终方案：
 * - 主进程一次性批量提取系统图标（System.Drawing），命中率高；
 * - 结果以 dataURL 直接写回 app.icon，不走自定义协议、不读临时文件；
 * - 磁盘按应用名缓存，二次启动直接复用。
 */
const loadAllIcons = async (apps: Array<any>): Promise<void> => {
  if (!apps.length) return;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { ipcRenderer } = require('electron');

  // 1. 先看磁盘缓存
  const need: Array<any> = [];
  for (const app of apps) {
    const iconpath = path.join(icondir, `${safeIconName(app.name)}.png`);
    try {
      const buf = fs.readFileSync(iconpath);
      if (buf.length > 0) {
        app.icon = `data:image/png;base64,${buf.toString('base64')}`;
        continue;
      }
    } catch (e) {
      // 无缓存
    }
    need.push(app);
  }
  if (!need.length) return;

  // 2. 批量向主进程请求
  let map: Record<string, string> = {};
  try {
    map = await Promise.race([
      ipcRenderer.invoke('msg-trigger-async', {
        type: 'batchGetFileIcons',
        data: { paths: need.map((a) => a.desc) },
      }),
      new Promise((resolve) => setTimeout(() => resolve({}), 20000)),
    ]);
  } catch (e) {
    map = {};
  }

  // 3. 写回 icon 并落盘缓存
  const misses: Array<any> = [];
  for (const app of need) {
    const dataUrl = map && map[app.desc];
    if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image')) {
      app.icon = dataUrl;
      const base64 = dataUrl.split(',')[1];
      if (base64) {
        try {
          fs.writeFileSync(
            path.join(icondir, `${safeIconName(app.name)}.png`),
            Buffer.from(base64, 'base64')
          );
        } catch (e) {
          //
        }
      }
    } else {
      misses.push(app);
    }
  }

  // 4. 批量没拿到的，再逐个用 Electron 兜底（数量通常很少）
  for (const app of misses) {
    try {
      const dataUrl = await Promise.race([
        ipcRenderer.invoke('msg-trigger-async', {
          type: 'getFileIcon',
          data: { path: app.desc },
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 3000)
        ),
      ]);
      if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image')) {
        app.icon = dataUrl;
      }
    } catch (e) {
      //
    }
  }
};

// 递归扫描目录，返回 Promise，保证调用方拿到的是已完整填充的列表
function fileDisplay(dirPath: string): Promise<void> {
  return new Promise((resolve) => {
    fs.readdir(dirPath, (err, files) => {
      if (err) {
        console.warn(err);
        return resolve();
      }
      const tasks: Array<Promise<void>> = [];
      files.forEach((filename) => {
        const filedir = path.join(dirPath, filename);
        let stats: any;
        try {
          stats = fs.statSync(filedir);
        } catch (e) {
          return;
        }
        if (stats.isFile()) {
          const appName = filename.split('.')[0];
          const keyWords = [appName];
          let appDetail: any = {};
          try {
            appDetail = shell.readShortcutLink(filedir);
          } catch (e) {
            //
          }
          if (
            !appDetail.target ||
            appDetail.target.toLowerCase().indexOf('unin') >= 0
          ) {
            return;
          }

          // C:/program/cmd.exe => cmd
          keyWords.push(path.basename(appDetail.target, '.exe'));

          if (!isZhRegex.test(appName)) {
            const firstLatter = appName
              .split(' ')
              .map((name) => name[0])
              .join('');
            keyWords.push(firstLatter);
          }

          // icon 先留空，由 getico() 异步填入 dataURL。
          // 不再使用 image:// 协议——含空格/中文的临时路径在 URL 规范化后
          // 协议解析会失败，导致图标空白。
          const appInfo = {
            value: 'plugin',
            desc: appDetail.target,
            type: 'app',
            icon: '',
            pluginType: 'app',
            action: `start "dummyclient" "${appDetail.target}"`,
            keyWords: keyWords,
            name: appName,
            names: JSON.parse(JSON.stringify(keyWords)),
          };
          fileLists.push(appInfo);
        } else if (stats.isDirectory()) {
          tasks.push(fileDisplay(filedir)); // 递归子目录
        }
      });
      Promise.all(tasks).then(() => resolve());
    });
  });
}

export default async () => {
  await Promise.all([fileDisplay(filePath), fileDisplay(startMenu)]);
  // 列表收集完成后批量取图标（一次 IPC，避免上百次进程调用）
  await loadAllIcons(fileLists);
  return fileLists;
};
