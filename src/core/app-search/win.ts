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

// 同一路径只请求一次，避免重复 IPC
const iconTaskCache = new Map<string, Promise<void>>();

// 应用名可能含 Windows 非法文件名字符，需清洗；
// 注意不能用 encodeURIComponent——主进程 image:// 协议会 decodeURI，
// 编码后的文件名解码后找不到对应文件。
const safeIconName = (name: string): string =>
  name.replace(/[\\/:*?"<>|]/g, '_');

/**
 * 生成单个应用图标。
 *
 * 说明：原先使用 extract-file-icon（原生模块），但其 addon.node 不会被打进
 * app.asar，打包后 require 必然失败、图标全空白。改为调用主进程
 * app.getFileIcon()，无原生依赖，且对 .lnk 快捷方式同样有效。
 */
const getico = (app): Promise<void> => {
  const appName = app.name;
  if (iconTaskCache.has(appName)) return iconTaskCache.get(appName)!;
  const task = (async () => {
    try {
      // 重要：文件名必须与下方 icon 字段构造出的路径**完全一致**。
      // 主进程 image:// 协议处理器会做 decodeURI()，因此这里不能用
      // encodeURIComponent 命名，否则解码后路径指向不存在的文件，图标全空白。
      const iconpath = path.join(icondir, `${safeIconName(appName)}.png`);
      try {
        if (fs.statSync(iconpath).size > 0) return;
      } catch (e) {
        // 文件不存在，继续生成
      }
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { ipcRenderer } = require('electron');
      const dataUrl = await Promise.race([
        ipcRenderer.invoke('msg-trigger-async', {
          type: 'getFileIcon',
          data: { path: app.desc },
        }),
        // 单个图标最长等待 3s，避免个别快捷方式卡住拖垮整体
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 3000)
        ),
      ]);
      if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image')) {
        return;
      }
      const base64 = dataUrl.split(',')[1];
      if (!base64) return;
      fs.writeFileSync(iconpath, Buffer.from(base64, 'base64'));
    } catch (e) {
      // 单个图标失败不影响整体，静默跳过
    }
  })();
  iconTaskCache.set(appName, task);
  return task;
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

          // 与 darwin 保持一致，走已注册的 image:// 协议，
          // 否则裸路径无法被 <img src> 加载
          // 与 getico 写盘路径保持一致（含非法字符清洗），
          // 且不使用 encodeURIComponent——主进程 image:// 协议会执行 decodeURI()
          const icon =
            'image://' +
            path.join(os.tmpdir(), 'ProcessIcon', `${safeIconName(appName)}.png`);

          const appInfo = {
            value: 'plugin',
            desc: appDetail.target,
            type: 'app',
            icon,
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

// 限制并发，避免一次性对上百个快捷方式发起 IPC 导致主进程阻塞
const CONCURRENCY = 8;

async function runWithLimit<T>(tasks: Array<() => Promise<T>>): Promise<void> {
  let index = 0;
  const workers = new Array(Math.min(CONCURRENCY, tasks.length))
    .fill(0)
    .map(async () => {
      while (index < tasks.length) {
        const task = tasks[index++];
        try {
          await task();
        } catch (e) {
          // 单个失败不影响整体
        }
      }
    });
  await Promise.all(workers);
}

export default async () => {
  await Promise.all([fileDisplay(filePath), fileDisplay(startMenu)]);
  // 列表收集完成后再统一取图标，并做并发控制
  await runWithLimit(fileLists.map((app) => () => getico(app)));
  return fileLists;
};
