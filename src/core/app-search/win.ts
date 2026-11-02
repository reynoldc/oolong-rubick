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
 * 生成单个应用图标，并**直接把 dataURL 写回 app.icon**。
 *
 * 历史问题：
 * 1) extract-file-icon 是原生模块，addon.node 不会被打进 app.asar，打包后
 *    require 必然失败；
 * 2) 改用 app.getFileIcon 后落盘到 %TEMP%，再用 image:// 协议读取，
 *    但路径含空格/中文时 URL 规范化会让协议解析失败，图标依旧空白
 *    （DeepSeek Harness 这类带空格的安装路径必现）。
 *
 * 因此最终方案：图标以 dataURL 形式直接内嵌到 app.icon，
 * 不依赖自定义协议、不依赖临时文件、不受路径字符影响。
 * 落盘仅作为二次启动的加速缓存。
 */
const getico = (app): Promise<void> => {
  const appName = app.name;
  if (iconTaskCache.has(appName)) return iconTaskCache.get(appName)!;
  const task = (async () => {
    try {
      const iconpath = path.join(icondir, `${safeIconName(appName)}.png`);
      // 命中磁盘缓存：读回并转 dataURL
      try {
        const buf = fs.readFileSync(iconpath);
        if (buf.length > 0) {
          app.icon = `data:image/png;base64,${buf.toString('base64')}`;
          return;
        }
      } catch (e) {
        // 无缓存，继续生成
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
      // 关键：直接内嵌，避免再走 image:// 协议
      app.icon = dataUrl;
      const base64 = dataUrl.split(',')[1];
      if (!base64) return;
      try {
        fs.writeFileSync(iconpath, Buffer.from(base64, 'base64'));
      } catch (e) {
        // 缓存写入失败不影响显示
      }
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
