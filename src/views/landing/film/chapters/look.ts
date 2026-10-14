import type { Director } from '../director';
import type { Chapter, Shot } from '../types';

/** 序：黑场里只有标语，同时把应用在后台摆到概览（遮住第一次加载）。 */
export const prologue: Chapter = {
  id: 'prologue',
  label: 'tagline',
  shots: [{
    id: 'tagline', ms: 3600, pose: 'title', caption: 'tagline',
    async run(d) { await d.clear(); await d.go('/'); },
  }],
};

/** 按位置点（不按文字：访客用别的语言时 iframe 里也是那种语言）。 */
export const tapNth = async (d: Director, selector: string, index: number, after = 520) => d.tap(await d.find(selector, { index }), { after, travel: 260 });
export const PAGE_TRACK = '.main-content .page .segment-track';
export const ADD_EVENT = '#life-events .le-head .pill-button';

/** 第一章 外观前半（计划 1.1–1.3）。 */
export const lookIntro: Shot[] = [
  {
    // 1.1 玻璃：顶栏导航 → 关注分类 → 主题 → 时间跨度 → 运动类型滚轮，每根微距一下，最后拉远。
    id: 'glass', ms: 16000, pose: 'full', caption: 'glass',
    async run(d) {
      await d.camera('.pill-nav', { zoom: 3.2, ms: 900 });
      await d.drag('.pill-nav .segment-item', { x: 150, y: 0 }, { roundTrip: true, ms: 1100, settle: 200, grab: 180 });
      await d.camera(PAGE_TRACK, { zoom: 2.8, ms: 600, hold: 300 });
      for (const index of [1, 2, 3, 0]) await tapNth(d, `${PAGE_TRACK} .segment-item`, index, 380);
      await d.camera('.theme-toggle', { zoom: 3.2, ms: 600, hold: 300 });
      await d.drag('.theme-toggle .segment-item', { x: 70, y: 0 }, { roundTrip: true, ms: 900, settle: 150, grab: 180 });
      await d.cut(async () => { await d.go('/training', 400); });
      await d.camera(PAGE_TRACK, { zoom: 2.8, ms: 500, hold: 200 });
      for (const index of [1, 2, 0]) await tapNth(d, `${PAGE_TRACK} .segment-item`, index, 420);
      await d.cut(async () => { await d.go('/recent', 300); await d.tap(await d.find(`${PAGE_TRACK} .segment-item`, { index: 2 }), { after: 400, travel: 1 }); });
      await d.camera('.main-content .page .capsule-wheel', { zoom: 2.8, ms: 500, hold: 200 });
      await d.drag('.main-content .page .capsule-wheel', { x: -90, y: 0 }, { ms: 600, settle: 350, grab: 150 });
      await d.drag('.main-content .page .capsule-wheel', { x: 90, y: 0 }, { ms: 600, settle: 300, grab: 150 });
      await d.camera(null, { ms: 800 });
    },
  },
  {
    // 1.2 从哪里来，回哪里去：首页睡眠卡 ↔ 睡眠页；设置卡 ↔ 卡页。展开那一下放慢。
    id: 'morph', ms: 13000, pose: 'full', caption: 'morph',
    async run(d) {
      await d.cut(async () => { await d.go('/', 500); });
      d.rate(0.55);
      try {
        await d.tap('.sleep-panel', { after: 1700 });
        await d.tap('.quick-back', { after: 1700 });
        await d.cut(async () => { await d.go('/settings', 600); });
        await d.tap('button.list-open', { after: 1700 });
        await d.tap('.deck-close', { after: 1600 });
      } finally { d.rate(1); }
    },
  },
  {
    // 1.3 焦点模糊：睡眠时长的说明、添加生活事件。
    id: 'focus', ms: 9000, pose: 'full', caption: 'focus',
    async run(d) {
      await d.cut(async () => { await d.go('/', 400); await d.tap('.sleep-panel', { after: 900, travel: 1 }); });
      await d.tap('.hero-duration .metric-info', { after: 1900 });
      await d.escape(500);
      await d.cut(async () => { await d.go('/', 300); await d.scrollTo(ADD_EVENT, 260, 1); });
      await d.tap(ADD_EVENT, { after: 2000 });
      await d.escape(400);
    },
  },
];
