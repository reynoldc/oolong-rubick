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
  document.body.classList.toggle('liquid-glass', on);
  // 浏览器默认给 html/body 不透明白底，若不显式置透明，
  // 会看到一整块白色矩形盖住系统毛玻璃。CSS 里 :has() 兜底，
  // 这里再直接设置一次，确保生效。
  if (on) {
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
  } else {
    document.documentElement.style.background = '';
    document.body.style.background = '';
  }
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
