<template>
  <div v-show="!currentPlugin.name" class="options">
    <QuickLaunch
      v-if="showQuickLaunch"
      :pluginHistory="pluginHistory"
      :favoriteApps="favoriteApps"
      :appList="appList"
      :currentSelect="currentSelect"
      @launch="onQuickLaunch"
      @favorite-add="(app) => emit('favoriteAdd', app)"
      @favorite-remove="(app) => emit('favoriteRemove', app)"
      @history-set="(list) => emit('setPluginHistory', list)"
    />
    <a-list v-else item-layout="horizontal" :dataSource="sort(options)">
      <template #renderItem="{ item, index }">
        <a-list-item
          @click="() => item.click()"
          :class="currentSelect === index ? 'active op-item' : 'op-item'"
        >
          <a-list-item-meta :description="renderDesc(item.desc)">
            <template #title>
              <span v-html="renderTitle(item.name, item.match)"></span>
            </template>
            <template #avatar>
              <a-avatar style="border-radius: 0" :src="item.icon" />
            </template>
          </a-list-item-meta>
        </a-list-item>
      </template>
    </a-list>
  </div>
</template>

<script lang="ts" setup>
import { defineEmits, defineProps, ref, computed } from 'vue';
import localConfig from '../confOp';
import QuickLaunch from './quick-launch.vue';

const path = window.require('path');
const remote = window.require('@electron/remote');

declare const __static: string;

const config: any = ref(localConfig.getConfig());

const props: any = defineProps({
  searchValue: {
    type: [String, Number],
    default: '',
  },
  options: {
    type: Array,
    default: (() => [])(),
  },
  currentSelect: {
    type: Number,
    default: 0,
  },
  currentPlugin: {},
  pluginHistory: (() => [])(),
  favoriteApps: (() => [])(),
  appList: (() => [])(),
  clipboardFile: (() => [])(),
});

const emit = defineEmits([
  'choosePlugin',
  'setPluginHistory',
  'favoriteAdd',
  'favoriteRemove',
]);

// 仅在「无搜索关键词、无剪贴板内容、未进入插件」时展示快速启动面板
const showQuickLaunch = computed(
  () =>
    !props.options.length &&
    !props.searchValue &&
    !props.clipboardFile.length &&
    config.value.perf.common.history
);

const onQuickLaunch = ({ item }) => {
  emit('choosePlugin', item);
};

const renderTitle = (title, match) => {
  if (typeof title !== 'string') return;
  if (!props.searchValue || !match) return title;
  const result = title.substring(match[0], match[1] + 1);
  return `<div>${title.substring(
    0,
    match[0]
  )}<span style='color: var(--ant-error-color)'>${result}</span>${title.substring(
    match[1] + 1,
    title.length
  )}</div>`;
};

const renderDesc = (desc = '') => {
  if (desc.length > 80) {
    return `${desc.substr(0, 63)}...${desc.substr(
      desc.length - 14,
      desc.length
    )}`;
  }
  return desc;
};

const sort = (options) => {
  for (let i = 0; i < options.length; i++) {
    for (let j = i + 1; j < options.length; j++) {
      if (options[j].zIndex > options[i].zIndex) {
        let temp = options[i];
        options[i] = options[j];
        options[j] = temp;
      }
    }
  }
  return options.slice(0, 20);
};
</script>

<style lang="less">
.ellpise {
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
}

.contextmenu {
  margin: 0;
  background: #fff;
  z-index: 3000;
  position: absolute;
  list-style-type: none;
  padding: 5px 0;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 400;
  color: #333;
  box-shadow: 2px 2px 3px 0 rgba(0, 0, 0, 0.3);
}

.options {
  position: absolute;
  top: 60px;
  left: 0;
  width: 100%;
  z-index: 99;
  max-height: calc(~'100vh - 60px');
  overflow: auto;
  background: var(--color-body-bg);
  .op-item {
    padding: 0 10px;
    height: 70px;
    line-height: 50px;
    max-height: 500px;
    overflow: auto;
    background: var(--color-body-bg);
    color: var(--color-text-content);
    border-color: var(--color-border-light);
    border-bottom: 1px solid var(--color-border-light) !important;
    &.active {
      background: var(--color-list-hover);
    }
    .ant-list-item-meta-title {
      color: var(--color-text-content);
    }
    .ant-list-item-meta-description {
      color: var(--color-text-desc);
    }
  }
}
</style>
