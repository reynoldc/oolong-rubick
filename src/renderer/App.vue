<template>
  <div id="components-layout" @mousedown="onMouseDown">
    <Search
      :currentPlugin="currentPlugin"
      @changeCurrent="changeIndex"
      @onSearch="onSearch"
      @openMenu="openMenu"
      @changeSelect="changeSelect"
      :searchValue="searchValue"
      :placeholder="placeholder"
      :pluginLoading="pluginLoading"
      :pluginHistory="pluginHistory"
      :quickLaunchLength="quickLaunchLength"
      :clipboardFile="clipboardFile || []"
      @choosePlugin="choosePlugin"
      @focus="searchFocus"
      @clear-search-value="clearSearchValue"
      @clearClipbord="clearClipboardFile"
      @readClipboardContent="readClipboardContent"
    />
    <Result
      :pluginHistory="pluginHistory"
      :currentPlugin="currentPlugin"
      :searchValue="searchValue"
      :currentSelect="currentSelect"
      :options="options"
      :clipboardFile="clipboardFile || []"
      :favoriteApps="favoriteApps"
      :appList="appList"
      @setPluginHistory="setPluginHistory"
      @choosePlugin="choosePlugin"
      @favoriteAdd="addFavoriteApp"
      @favoriteRemove="removeFavoriteApp"
    />
  </div>
</template>

<script setup lang="ts">
import { watch, ref, toRaw, computed } from 'vue';
import { exec } from 'child_process';
import Result from './components/result.vue';
import Search from './components/search.vue';
import getWindowHeight, {
  SECTION_TITLE_HEIGHT,
  QUICK_LAUNCH_ROW_HEIGHT,
  FAVORITE_EMPTY_HEIGHT,
} from '../common/utils/getWindowHeight';
import createPluginManager from './plugins-manager';
import useDrag from '../common/utils/dragWindow';
import { getGlobal } from '@electron/remote';
import { PLUGIN_HISTORY } from '@/common/constans/renderer';
import { message } from 'ant-design-vue';
import localConfig from './confOp';

const { onMouseDown } = useDrag();
const remote = window.require('@electron/remote');

const {
  initPlugins,
  getPluginInfo,
  options,
  onSearch,
  searchValue,
  changeSelect,
  openPlugin,
  currentPlugin,
  placeholder,
  pluginLoading,
  searchFocus,
  clipboardFile,
  setSearchValue,
  clearClipboardFile,
  readClipboardContent,
  pluginHistory,
  setPluginHistory,
  changePluginHistory,
  favoriteApps,
  appList,
  addFavoriteApp,
  removeFavoriteApp,
} = createPluginManager();

initPlugins();

const config: any = ref(localConfig.getConfig());

const currentSelect = ref(0);
const menuPluginInfo: any = ref({});

// 近期使用（仅应用类，不含插件）
const recentApps = computed(() =>
  (pluginHistory.value || []).filter((item) => item.pluginType === 'app')
);

// 快速启动面板是否展示：「我的收藏」区块无论如何都要在（+ 是添加入口），
// 只有完全关闭 history 开关时才隐藏
const showQuickLaunch = computed(
  () =>
    !options.value.length &&
    !searchValue.value &&
    !clipboardFile.value.length &&
    config.value.perf.common.history
);

// 快速启动面板里的格子总数（先最近使用，再我的收藏）
const quickLaunchLength = computed(() => {
  if (!showQuickLaunch.value) return 0;
  return recentApps.value.length + (favoriteApps.value || []).length;
});

// 快速启动面板需要的窗口高度
const quickLaunchHeight = computed(() => {
  if (!showQuickLaunch.value) return 0;
  const recentLen = recentApps.value.length;
  const favLen = (favoriteApps.value || []).length;
  return (
    // 最近使用：标题 + 一行图标（无历史时整块不占高度）
    (recentLen > 0 ? SECTION_TITLE_HEIGHT + QUICK_LAUNCH_ROW_HEIGHT : 0) +
    // 我的收藏：标题 + 图标行/空态
    SECTION_TITLE_HEIGHT +
    (favLen > 0 ? QUICK_LAUNCH_ROW_HEIGHT : FAVORITE_EMPTY_HEIGHT)
  );
});

getPluginInfo({
  pluginName: 'feature',
  // eslint-disable-next-line no-undef
  pluginPath: `${__static}/feature/package.json`,
}).then((res) => {
  menuPluginInfo.value = res;
  remote.getGlobal('LOCAL_PLUGINS').addPlugin(res);
});

watch(
  [options, pluginHistory, favoriteApps, currentPlugin],
  () => {
    // 保持原版规则：默认自动选中第一项
    currentSelect.value = 0;
    if (currentPlugin.value.name) return;
    window.rubick.setExpendHeight(
      getWindowHeight(options.value, [], quickLaunchHeight.value)
    );
  },
  {
    immediate: true,
  }
);

// 方向键移动光标：
// 有搜索结果时在结果列表里走，否则在快速启动面板（最近使用 + 我的收藏）里走。
// 保持原版规则：默认已选中第一项，越界自动回绕。
const changeIndex = (index) => {
  const len = options.value.length || quickLaunchLength.value;
  if (!len) return;
  // 光标越界时（如列表长度变化）先归位
  if (currentSelect.value < 0 || currentSelect.value > len - 1) {
    currentSelect.value = index > 0 ? 0 : len - 1;
    return;
  }
  const next = currentSelect.value + index;
  if (next > len - 1) {
    currentSelect.value = 0;
  } else if (next < 0) {
    currentSelect.value = len - 1;
  } else {
    currentSelect.value = next;
  }
};

const openMenu = (ext) => {
  openPlugin({
    ...toRaw(menuPluginInfo.value),
    feature: menuPluginInfo.value.features[0],
    cmd: '插件市场',
    ext,
    click: () => openMenu(ext),
  });
};

window.rubick.openMenu = openMenu;

const choosePlugin = (plugin) => {
  if (options.value.length) {
    const currentChoose = options.value[currentSelect.value];
    currentChoose.click();
    return;
  }
  // 快速启动面板模式：按光标索引取项（先最近使用，再我的收藏）
  const quickItems = [
    ...(pluginHistory.value || []).filter((item) => item.pluginType === 'app'),
    ...(favoriteApps.value || []),
  ];
  const currentChoose = plugin || quickItems[currentSelect.value];
  if (!currentChoose) return;
  if (currentChoose.pluginType === 'app') {
    changePluginHistory(currentChoose);
    exec(currentChoose.action);
    return;
  }
  const localPlugins = getGlobal('LOCAL_PLUGINS').getLocalPlugins();
  let hasRemove = true;
  localPlugins.find((plugin) => {
    if (plugin.name === currentChoose.originName) {
      hasRemove = false;
      return true;
    }
    return false;
  });
  if (hasRemove) {
    const result = window.rubick.db.get(PLUGIN_HISTORY) || {};
    const history = result.data.filter(
      (item) => item.originName !== currentChoose.originName
    );
    setPluginHistory(history);
    return message.warning('插件已被卸载！');
  }
  changePluginHistory(currentChoose);
  window.rubick.openPlugin(
    JSON.parse(
      JSON.stringify({
        ...currentChoose,
        ext: {
          code: currentChoose.feature.code,
          type: currentChoose.cmd.type || 'text',
          payload: null,
        },
      })
    )
  );
};

const clearSearchValue = () => {
  setSearchValue('');
};
</script>

<style lang="less">
@import './assets/var.less';
#components-layout {
  height: 100vh;
  overflow: hidden;
  background: var(--color-body-bg);
  ::-webkit-scrollbar {
    width: 0;
  }
  &.drag {
    -webkit-app-region: drag;
  }
}
// 液态玻璃：容器本身透明，由内层玻璃面板提供质感。
// 若 CSS 变量未生效（--color-body-bg 仍为 #fff），这里兜底避免白色矩形。
body.liquid-glass #components-layout {
  background: transparent;
}
</style>
