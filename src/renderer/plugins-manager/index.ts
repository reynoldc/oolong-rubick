import { reactive, toRefs, ref } from 'vue';
import { nativeImage, ipcRenderer } from 'electron';
import { getGlobal } from '@electron/remote';
import appSearch from '@/core/app-search';
import { PluginHandler } from '@/core';
import path from 'path';
import commonConst from '@/common/utils/commonConst';
import { exec } from 'child_process';
import searchManager from './search';
import optionsManager from './options';
import {
  PLUGIN_INSTALL_DIR as baseDir,
  PLUGIN_HISTORY,
  FAVORITE_APPS,
} from '@/common/constans/renderer';
import { message } from 'ant-design-vue';

const createPluginManager = (): any => {
  const pluginInstance = new PluginHandler({
    baseDir,
  });

  const state: any = reactive({
    appList: [],
    plugins: [],
    localPlugins: [],
    currentPlugin: {},
    pluginLoading: false,
    pluginHistory: [],
    favoriteApps: [],
  });

  const appList: any = ref([]);

  const initPlugins = async () => {
    initPluginHistory();
    initFavoriteApps();
    try {
      // 整体限时 8s：图标生成依赖主进程 IPC，个别快捷方式可能卡住，
      // 超时则先返回空列表，保证主窗口不被阻塞（图标后续可重试生成）
      appList.value = await Promise.race([
        appSearch(nativeImage),
        new Promise((resolve) => setTimeout(() => resolve([]), 8000)),
      ]);
    } catch (e) {
      appList.value = [];
    }
    initLocalStartPlugin();
  };

  const initPluginHistory = () => {
    const result = window.rubick.db.get(PLUGIN_HISTORY) || {};
    if (result && result.data) {
      state.pluginHistory = result.data;
    }
  };

  const initFavoriteApps = () => {
    const result = window.rubick.db.get(FAVORITE_APPS) || {};
    if (result && result.data) {
      state.favoriteApps = result.data;
    }
  };

  const initLocalStartPlugin = () => {
    const result = ipcRenderer.sendSync('msg-trigger', {
      type: 'dbGet',
      data: { id: 'rubick-local-start-app' },
    });
    if (result && result.value) {
      appList.value.push(...result.value);
    }
  };

  window.removeLocalStartPlugin = ({ plugin }) => {
    appList.value = appList.value.filter((app) => app.desc !== plugin.desc);
  };

  window.addLocalStartPlugin = ({ plugin }) => {
    window.removeLocalStartPlugin({ plugin });
    appList.value.push(plugin);
  };

  const loadPlugin = async (plugin) => {
    setSearchValue('');
    ipcRenderer.send('msg-trigger', {
      type: 'setExpendHeight',
      data: 60,
    });
    state.pluginLoading = true;
    state.currentPlugin = plugin;
    // 自带的插件不需要检测更新
    if (plugin.name === 'rubick-system-feature') return;
    await pluginInstance.upgrade(plugin.name);
    state.pluginLoading = false;
  };

  const openPlugin = async (plugin, option) => {
    ipcRenderer.send('msg-trigger', {
      type: 'removePlugin',
    });
    window.initRubick();
    if (plugin.pluginType === 'ui' || plugin.pluginType === 'system') {
      if (state.currentPlugin && state.currentPlugin.name === plugin.name) {
        window.rubick.showMainWindow();
        return;
      }
      await loadPlugin(plugin);
      window.rubick.openPlugin(
        JSON.parse(
          JSON.stringify({
            ...plugin,
            ext: plugin.ext || {
              code: plugin.feature.code,
              type: plugin.cmd.type || 'text',
              payload: null,
            },
          })
        )
      );
    }
    if (plugin.pluginType === 'app') {
      try {
        exec(plugin.action);
      } catch (e) {
        message.error('启动应用出错，请确保启动应用存在！');
      }
    }
    changePluginHistory({
      ...plugin,
      ...option,
      originName: plugin.name,
    });
  };

  const changePluginHistory = (plugin) => {
    const unpin = state.pluginHistory.filter((plugin) => !plugin.pin);
    const pin = state.pluginHistory.filter((plugin) => plugin.pin);
    const isPin = state.pluginHistory.find((p) => p.name === plugin.name)?.pin;
    if (isPin) {
      pin.forEach((p, index) => {
        if (p.name === plugin.name) {
          plugin = pin.splice(index, 1)[0];
        }
      });
      pin.unshift(plugin);
    } else {
      unpin.forEach((p, index) => {
        if (p.name === plugin.name) {
          unpin.splice(index, 1);
        }
      });
      unpin.unshift(plugin);
    }
    if (state.pluginHistory.length > 8) {
      unpin.pop();
    }
    state.pluginHistory = [...pin, ...unpin];
    const result = window.rubick.db.get(PLUGIN_HISTORY) || {};
    window.rubick.db.put({
      _id: PLUGIN_HISTORY,
      _rev: result._rev,
      data: JSON.parse(JSON.stringify(state.pluginHistory)),
    });
  };

  const setPluginHistory = (plugins) => {
    state.pluginHistory = plugins;
    const unpin = state.pluginHistory.filter((plugin) => !plugin.pin);
    const pin = state.pluginHistory.filter((plugin) => plugin.pin);
    state.pluginHistory = [...pin, ...unpin];
    const result = window.rubick.db.get(PLUGIN_HISTORY) || {};
    window.rubick.db.put({
      _id: PLUGIN_HISTORY,
      _rev: result._rev,
      data: JSON.parse(JSON.stringify(state.pluginHistory)),
    });
  };

  const persistFavoriteApps = () => {
    const result = window.rubick.db.get(FAVORITE_APPS) || {};
    window.rubick.db.put({
      _id: FAVORITE_APPS,
      _rev: result._rev,
      data: JSON.parse(JSON.stringify(state.favoriteApps)),
    });
  };

  const addFavoriteApp = (app) => {
    if (state.favoriteApps.some((item) => item.action === app.action)) return;
    state.favoriteApps = [...state.favoriteApps, JSON.parse(JSON.stringify(app))];
    persistFavoriteApps();
  };

  const removeFavoriteApp = (app) => {
    state.favoriteApps = state.favoriteApps.filter(
      (item) => item.action !== app.action
    );
    persistFavoriteApps();
  };

  const isFavoriteApp = (app) =>
    state.favoriteApps.some((item) => item.action === app.action);

  const { searchValue, onSearch, setSearchValue, placeholder } =
    searchManager();
  const {
    options,
    searchFocus,
    setOptionsRef,
    clipboardFile,
    clearClipboardFile,
    readClipboardContent,
  } = optionsManager({
    searchValue,
    appList,
    openPlugin,
    currentPlugin: toRefs(state).currentPlugin,
  });
  // plugin operation
  const getPluginInfo = async ({ pluginName, pluginPath }) => {
    const pluginInfo = await pluginInstance.getAdapterInfo(
      pluginName,
      pluginPath
    );
    return {
      ...pluginInfo,
      icon: pluginInfo.logo,
      indexPath: commonConst.dev()
        ? 'http://localhost:8081/#/'
        : `file://${path.join(pluginPath, '../', pluginInfo.main)}`,
    };
  };

  const changeSelect = (select) => {
    state.currentPlugin = select;
  };

  const addPlugin = (plugin: any) => {
    state.plugins.unshift(plugin);
  };

  const removePlugin = (plugin: any) => {
    // todo
  };

  window.loadPlugin = (plugin) => loadPlugin(plugin);

  window.updatePlugin = ({ currentPlugin }: any) => {
    state.currentPlugin = currentPlugin;
    getGlobal('LOCAL_PLUGINS').updatePlugin(currentPlugin);
  };

  window.setCurrentPlugin = ({ currentPlugin }) => {
    state.currentPlugin = currentPlugin;
    setSearchValue('');
  };

  window.initRubick = () => {
    state.currentPlugin = {};
    setSearchValue('');
    setOptionsRef([]);
    window.setSubInput({ placeholder: '' });
  };

  window.pluginLoaded = () => {
    state.pluginLoading = false;
  };

  window.searchFocus = (args, strict) => {
    ipcRenderer.send('msg-trigger', {
      type: 'removePlugin',
    });
    window.initRubick();
    searchFocus(args, strict);
  };

  return {
    ...toRefs(state),
    initPlugins,
    addPlugin,
    removePlugin,
    onSearch,
    getPluginInfo,
    openPlugin,
    changeSelect,
    options,
    searchValue,
    placeholder,
    searchFocus,
    setSearchValue,
    clipboardFile,
    clearClipboardFile,
    readClipboardContent,
    setPluginHistory,
    changePluginHistory,
    favoriteApps: toRefs(state).favoriteApps,
    appList,
    addFavoriteApp,
    removeFavoriteApp,
    isFavoriteApp,
  };
};

export default createPluginManager;
