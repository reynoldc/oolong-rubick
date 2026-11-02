<template>
  <div class="quick-launch">
    <!-- 最近使用 -->
    <div v-if="recentApps.length" class="ql-section">
      <div class="ql-title">最近使用</div>
      <a-row :gutter="0">
        <a-col
          :class="cellClass('recent', index)"
          :span="3"
          v-for="(item, index) in recentApps"
          :key="`recent-${index}`"
          @click="() => launch(item, 'recent', index)"
          @contextmenu.prevent="openMenu($event, item)"
        >
          <a-avatar
            style="width: 28px; height: 28px"
            :src="item.icon"
            @error="onIconError"
          >
            <template #icon><AppstoreOutlined /></template>
          </a-avatar>
          <div class="name ellpise">{{ getAppName(item) }}</div>
          <div class="badge" v-if="item.pin"></div>
        </a-col>
      </a-row>
    </div>

    <!-- 我的收藏 -->
    <div class="ql-section">
      <div class="ql-title">
        <span>我的收藏</span>
        <PlusOutlined class="ql-add" @click="openPicker" />
      </div>
      <a-row v-if="favoriteApps.length" :gutter="0">
        <a-col
          :class="cellClass('favorite', index)"
          :span="3"
          v-for="(item, index) in favoriteApps"
          :key="`fav-${index}`"
          @click="() => launch(item, 'favorite', index)"
          @contextmenu.prevent="openFavoriteMenu($event, item)"
        >
          <a-avatar
            style="width: 28px; height: 28px"
            :src="item.icon"
            @error="onIconError"
          >
            <template #icon><AppstoreOutlined /></template>
          </a-avatar>
          <div class="name ellpise">{{ getAppName(item) }}</div>
        </a-col>
      </a-row>
      <div v-else class="ql-empty" @click="openPicker">
        点击 + 从本机应用中添加收藏
      </div>
    </div>

    <!-- 添加收藏：本机应用选择弹窗 -->
    <a-modal
      v-model:visible="pickerVisible"
      title="添加应用到我的收藏"
      :width="520"
      okText="关闭"
      :footer="null"
      @cancel="pickerVisible = false"
    >
      <a-input
        v-model:value="pickerKeyword"
        placeholder="搜索本机应用"
        allowClear
        style="margin-bottom: 12px"
      />
      <div class="picker-list">
        <div
          class="picker-item"
          v-for="(app, i) in pickerList"
          :key="`pick-${i}`"
          @click="() => pickApp(app)"
        >
          <a-avatar
            style="width: 24px; height: 24px; border-radius: 0"
            :src="app.icon"
          />
          <span class="picker-name">{{ getAppName(app) }}</span>
          <PlusOutlined class="picker-add" />
        </div>
        <div v-if="!pickerList.length" class="picker-empty">没有匹配的应用</div>
      </div>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  ref,
  watch,
  defineProps,
  defineEmits,
  defineExpose,
} from 'vue';
import { AppstoreOutlined, PlusOutlined } from '@ant-design/icons-vue';

const path = window.require('path');
const remote = window.require('@electron/remote');

declare const __static: string;

const props: any = defineProps({
  pluginHistory: (() => [])(),
  favoriteApps: (() => [])(),
  appList: (() => [])(),
  currentSelect: { type: Number, default: -1 },
});

const emit = defineEmits(['favorite-add', 'favorite-remove', 'history-set']);

// 最近使用：只保留真正的应用（排除插件）
const recentApps = computed(() =>
  (props.pluginHistory || []).filter((item) => item.pluginType === 'app')
);

// 键盘光标落点顺序：先走完最近使用，再走收藏
const orderedCells = computed(() => [
  ...recentApps.value.map((item, index) => ({
    item,
    group: 'recent',
    index,
  })),
  ...(props.favoriteApps || []).map((item, index) => ({
    item,
    group: 'favorite',
    index,
  })),
]);

defineExpose({ length: orderedCells });

const cellClass = (group, index) => {
  const pos = orderedCells.value.findIndex(
    (cell) => cell.group === group && cell.index === index
  );
  return pos === props.currentSelect ? 'ql-item active' : 'ql-item';
};

const getAppName = (item) =>
  item.cmd || item.pluginName || item._name || item.name;

// 图标加载失败时兜底，避免出现裂图
const onIconError = (e) => {
  if (e && e.target) e.target.style.visibility = 'hidden';
};

const launch = (item, group, index) => {
  const pos = orderedCells.value.findIndex(
    (cell) => cell.group === group && cell.index === index
  );
  // 交由父组件按统一光标索引处理，保证键盘/鼠标行为一致
  emit('launch', { item, index: pos });
};

// ---- 右键菜单 ----
const menuState: any = ref(null);
let mainMenus;
let favoriteMenus;

const buildMenus = () => {
  mainMenus = remote.Menu.buildFromTemplate([
    {
      id: 'removeRecentCmd',
      label: '从"最近使用"中删除',
      icon: path.join(__static, 'icons', 'delete@2x.png'),
      click: () => {
        const history = (props.pluginHistory || []).filter(
          (item) => item !== menuState.value
        );
        emit('history-set', JSON.parse(JSON.stringify(history)));
      },
    },
    {
      id: 'addFavorite',
      label: '添加到"我的收藏"',
      icon: path.join(__static, 'icons', 'pin@2x.png'),
      click: () => {
        emit('favorite-add', JSON.parse(JSON.stringify(menuState.value)));
      },
    },
  ]);

  favoriteMenus = remote.Menu.buildFromTemplate([
    {
      id: 'removeFavorite',
      label: '从"我的收藏"中删除',
      icon: path.join(__static, 'icons', 'delete@2x.png'),
      click: () => {
        emit('favorite-remove', JSON.parse(JSON.stringify(menuState.value)));
      },
    },
  ]);
};

buildMenus();

const openMenu = (e, item) => {
  menuState.value = item;
  mainMenus.popup({ x: e.pageX, y: e.pageY });
};

const openFavoriteMenu = (e, item) => {
  menuState.value = item;
  favoriteMenus.popup({ x: e.pageX, y: e.pageY });
};

// ---- 添加收藏：从本机应用列表选择 ----
const pickerVisible = ref(false);
const pickerKeyword = ref('');
const pickerList = ref([]);

const openPicker = () => {
  pickerKeyword.value = '';
  filterApps();
  pickerVisible.value = true;
};

const filterApps = () => {
  const kw = pickerKeyword.value.trim().toLowerCase();
  const favActions = new Set(
    (props.favoriteApps || []).map((item) => item.action)
  );
  pickerList.value = (props.appList || [])
    .filter((app) => !favActions.has(app.action))
    .filter((app) => {
      if (!kw) return true;
      return (app.keyWords || []).some((word) =>
        String(word).toLowerCase().includes(kw)
      );
    })
    .slice(0, 50);
};

watch(pickerKeyword, filterApps);

const pickApp = (app) => {
  emit('favorite-add', JSON.parse(JSON.stringify(app)));
  filterApps();
};
</script>

<style lang="less">
.quick-launch {
  width: 100%;
  box-sizing: border-box;
  .ql-section {
    border-top: 1px dashed var(--color-border-light);
    padding-bottom: 4px;
  }
  .ql-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 12px;
    color: var(--color-text-desc);
    padding: 6px 12px 2px;
    .ql-add {
      cursor: pointer;
      &:hover {
        color: var(--ant-primary-color);
      }
    }
  }
  .ql-item {
    cursor: pointer;
    box-sizing: border-box;
    height: 68px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    color: var(--color-text-content);
    position: relative;
    &.active {
      background: var(--color-list-hover);
      border-radius: 6px;
    }
    .name {
      font-size: 12px;
      margin-top: 4px;
      width: 100%;
      text-align: center;
      padding: 0 2px;
    }
    .badge {
      position: absolute;
      top: 2px;
      right: 2px;
      width: 0;
      height: 0;
      border-radius: 4px;
      border-top: 6px solid var(--ant-primary-4);
      border-right: 6px solid var(--ant-primary-4);
      border-left: 6px solid transparent;
      border-bottom: 6px solid transparent;
    }
  }
  .ql-empty {
    font-size: 12px;
    color: var(--color-text-desc);
    padding: 8px 12px 12px;
    cursor: pointer;
    &:hover {
      color: var(--ant-primary-color);
    }
  }
}
.picker-list {
  max-height: 320px;
  overflow: auto;
  .picker-item {
    display: flex;
    align-items: center;
    padding: 6px 8px;
    cursor: pointer;
    border-radius: 4px;
    &:hover {
      background: var(--color-list-hover);
    }
    .picker-name {
      margin-left: 10px;
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--color-text-content);
    }
    .picker-add {
      color: var(--color-text-desc);
    }
  }
  .picker-empty {
    text-align: center;
    color: var(--color-text-desc);
    font-size: 12px;
    padding: 16px 0;
  }
}
.ellpise {
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
}
</style>
