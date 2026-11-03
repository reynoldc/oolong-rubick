<template>
  <div class="user-info">
    <div class="settings-container">
      <div class="setting-item">
        <div class="title">
          {{ $t('feature.settings.account.themeColor') }}
        </div>
        <div class="settings-item-li">
          <a-radio-group @change="changeTheme" v-model:value="theme" button-style="solid">
            <a-radio-button value="SPRING">{{ $t('feature.settings.account.spring') }}</a-radio-button>
            <a-radio-button value="SUMMER">{{ $t('feature.settings.account.summer') }}</a-radio-button>
            <a-radio-button value="AUTUMN">{{ $t('feature.settings.account.autumn') }}</a-radio-button>
            <a-radio-button value="WINTER">{{ $t('feature.settings.account.winter') }}</a-radio-button>
            <a-radio-button value="LIQUID_GLASS">{{ $t('feature.settings.account.liquidGlass') }}</a-radio-button>
          </a-radio-group>
        </div>
      </div>

      <!-- 液态玻璃外观调节：仅在选中液态玻璃主题时展示 -->
      <div class="setting-item" v-if="theme === 'LIQUID_GLASS'">
        <div class="title">
          {{ $t('feature.settings.account.glassStyle') }}
        </div>
        <div class="settings-item-li">
          <div class="label">{{ $t('feature.settings.account.glassTransparency') }}</div>
          <a-slider
            v-model:value="glass.transparency"
            :min="0"
            :max="100"
            :tip-formatter="(v) => v + '%'"
            class="value"
          />
        </div>
        <div class="settings-item-li">
          <div class="label">{{ $t('feature.settings.account.glassBlur') }}</div>
          <a-slider
            v-model:value="glass.blur"
            :min="0"
            :max="40"
            :tip-formatter="(v) => v + 'px'"
            class="value"
          />
        </div>
        <div class="settings-item-li">
          <div class="label">{{ $t('feature.settings.account.glassPrimaryColor') }}</div>
          <a-input v-model:value="glass.primaryColor" class="value" />
        </div>
        <div class="settings-item-li">
          <div class="label">{{ $t('feature.settings.account.glassBgFrom') }}</div>
          <a-input v-model:value="glass.bgFrom" class="value" />
        </div>
        <div class="settings-item-li">
          <div class="label">{{ $t('feature.settings.account.glassBgTo') }}</div>
          <a-input v-model:value="glass.bgTo" class="value" />
        </div>
        <div class="settings-item-li">
          <div class="label">{{ $t('feature.settings.account.glassReset') }}</div>
          <a-button shape="round" size="small" @click="resetGlass">
            {{ $t('feature.settings.account.glassReset') }}
          </a-button>
        </div>
      </div>

      <div class="setting-item">
        <div class="title">
          {{ $t('feature.settings.account.personalized') }}
        </div>
        <div class="settings-item-li">
          <div class="label">
            {{ $t('feature.settings.account.greeting') }}
          </div>
          <a-input v-model:value="custom.placeholder" class="value"></a-input>
        </div>
        <div class="settings-item-li">
          <div class="label">
            {{ $t('feature.settings.account.name') }}
          </div>
          <a-input v-model:value="custom.username" class="value"></a-input>
        </div>
        <div class="settings-item-li">
          <div class="label">
            {{ $t('feature.settings.account.logo') }}
          </div>
          <div class="img-container">
            <img class="custom-img" :src="custom.logo" />
            <a-button class="btn" @click="changeLogo" shape="round" size="small" type="primary">
              {{ $t('feature.settings.account.replace') }}
            </a-button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { reactive, toRefs, watch, ref } from 'vue';
import debounce from 'lodash.debounce';
import localConfig from '@/confOp';
import * as Themes from '@/assets/constans';
const { ipcRenderer } = window.require('electron');

const state = reactive({
  custom: {},
});

const { perf } = localConfig.getConfig();

const theme = ref(perf.custom.theme);

state.custom = perf.custom || {};

// 液态玻璃外观参数默认值（与主窗口 var.less 的默认值保持一致）
const GLASS_DEFAULTS = {
  transparency: 45, // 面板不透明度 0-100，越大越实
  blur: 20, // 模糊半径 px
  primaryColor: '#7dd3fc',
  bgFrom: '#1b2540',
  bgTo: '#0b1020',
};

const glass = reactive({
  ...GLASS_DEFAULTS,
  ...(state.custom.glass || {}),
});

const resetGlass = () => {
  Object.assign(glass, GLASS_DEFAULTS);
  state.custom.glass = { ...GLASS_DEFAULTS };
};

// 玻璃参数变化时同步进 custom，并由 setConfig 持久化
watch(
  glass,
  () => {
    state.custom.glass = { ...glass };
  },
  { deep: true }
);

const setConfig = debounce(() => {
  const { perf } = localConfig.getConfig();

  localConfig.setConfig(
    JSON.parse(
      JSON.stringify({
        perf: {
          ...perf,
          custom: state.custom,
        },
      })
    )
  );
  // 通知主窗口重新应用主题（含玻璃参数）
  ipcRenderer.send('re-register');
}, 500);

watch(state, setConfig);
const { custom } = toRefs(state);

const changeLogo = () => {
  const [logoPath] = window.rubick.showOpenDialog({
    title: '请选择 logo 路径',
    filters: [{ name: 'images', extensions: ['png'] }],
    properties: ['openFile'],
  });
  state.custom.logo = `file://${logoPath}`;
};

const changeTheme = () => {
  state.custom = {
    ...state.custom,
    ...Themes[theme.value],
  };
  // 液态玻璃需要主窗口以 transparent 创建才能透出系统毛玻璃，
  // 而窗口透明属性只能在创建时设定，故必须重启后才完整生效。
  if (theme.value === 'LIQUID_GLASS') {
    ipcRenderer.send('msg-trigger', {
      type: 'showNotification',
      data: { body: '液态玻璃主题将在重启 Rubick 后完整生效' },
    });
  }
};

// const reset = () => {
//   Modal.warning({
//     title: '确定恢复默认设置吗？',
//     content: '回复后之前的设置将会被清空',
//     onOk() {
//       const defaultcustom = remote.getGlobal('OP_CONFIG').getDefaultConfig()
//         .perf.custom;
//       state.custom = JSON.parse(JSON.stringify(defaultcustom));
//     },
//   });
// };
</script>

<style lang="less">
.ant-radio-button-wrapper {
  background: var(--color-body-bg);
  color: var(--color-text-content);
}
.user-info-result {
  padding: 0;
  .theme-preview {
    width: 20px;
    height: 20px;
    border-radius: 100%;
  }
  &.ant-result {
    padding: 24px;
  }
  .icon {
    font-size: 48px;
  }
  .ant-result-icon {
    margin-bottom: 12px;
  }
  .ant-result-title {
    font-size: 18px;
  }
}
.img-container {
  width: 300px;
  .btn {
    margin-left: 10px;
    font-size: 12px;
  }
}
.custom-img {
  width: 60px;
  height: 60px;
}
.footer-btn {
  text-align: right;
  border-top: 1px dashed #ddd;
  padding-top: 12px;
}
</style>
