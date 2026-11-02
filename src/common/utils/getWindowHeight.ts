const WINDOW_MAX_HEIGHT = 620;
const WINDOW_MIN_HEIGHT = 60;
const PRE_ITEM_HEIGHT = 70;
const HISTORY_HEIGHT = 70;
// 快速启动面板：区块标题 + 一行图标
export const SECTION_TITLE_HEIGHT = 28;
export const QUICK_LAUNCH_ROW_HEIGHT = 76;
// 「我的收藏」空态提示的高度（保证 + 入口始终可见/可点）
export const FAVORITE_EMPTY_HEIGHT = 40;

/**
 * 计算主窗口高度
 * @param searchList 搜索结果列表
 * @param historyList 历史/收藏列表（用于兼容旧的仅历史布局）
 * @param quickLaunchHeight 快速启动面板额外需要的高度
 */
export default (
  searchList: Array<any>,
  historyList,
  quickLaunchHeight = 0
): number => {
  const defaultHeight =
    quickLaunchHeight ||
    (historyList && historyList.length ? HISTORY_HEIGHT : 0);
  if (!searchList) return WINDOW_MAX_HEIGHT + defaultHeight;
  if (!searchList.length) return WINDOW_MIN_HEIGHT + defaultHeight;
  const target =
    searchList.length * PRE_ITEM_HEIGHT + WINDOW_MIN_HEIGHT + defaultHeight;
  return target > WINDOW_MAX_HEIGHT ? WINDOW_MAX_HEIGHT : target;
};
