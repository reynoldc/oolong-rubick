import { createApp } from 'vue';
import {
  Button,
  List,
  Spin,
  Input,
  Avatar,
  Tag,
  ConfigProvider,
  Row,
  Col,
  Divider,
  Modal,
} from 'ant-design-vue';
import App from './App.vue';
import localConfig from './confOp';

import 'ant-design-vue/dist/antd.variable.min.css';

const config: any = localConfig.getConfig();

// 液态玻璃主题：挂到 body，供 var.less 中的 .liquid-glass 规则命中。
// 切换主题时同步维护该 class。
const LIQUID_GLASS = 'LIQUID_GLASS';

const syncGlassClass = (cfg: any) => {
  const on = cfg?.perf?.custom?.theme === LIQUID_GLASS;
  // CSS 方案：class 同时挂到 html 和 body，
  // 便于背景渐变、面板样式等规则命中最外层元素
  document.documentElement.classList.toggle('liquid-glass', on);
  document.body.classList.toggle('liquid-glass', on);
  return on;
};

const glassOn = syncGlassClass(config);

// 通知主进程同步窗口材质（acrylic），使桌面背景真正透过来
try {
  const { ipcRenderer } = window.require('electron');
  ipcRenderer.send('msg-trigger', {
    type: 'setWindowMaterial',
    data: { glass: glassOn },
  });
} catch (e) {
  // 主进程不支持时静默降级为纯 CSS 效果
}

ConfigProvider.config({
  theme: config.perf.custom || {},
});

window.rubick.changeTheme = () => {
  const config: any = localConfig.getConfig();
  ConfigProvider.config({
    theme: config.perf.custom || {},
  });
  // 主题切换后同步玻璃 class 与窗口材质
  const on = syncGlassClass(config);
  try {
    const { ipcRenderer } = window.require('electron');
    ipcRenderer.send('msg-trigger', {
      type: 'setWindowMaterial',
      data: { glass: on },
    });
  } catch (e) {
    //
  }
};

createApp(App)
  .use(Button)
  .use(List)
  .use(Spin)
  .use(Input)
  .use(Avatar)
  .use(Tag)
  .use(Row)
  .use(Col)
  .use(Divider)
  .use(Modal)
  .mount('#app');
