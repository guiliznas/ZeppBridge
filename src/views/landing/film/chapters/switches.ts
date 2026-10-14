import { LANDING_LOCALES } from '../../../../composables/useLandingLocale';
import type { Shot } from '../types';

/** 第一章收尾：日月切换、灰烬换语言（计划 1.7–1.8）。都点应用顶栏里的真控件，扩散从控件处起。 */
export const lookSwitches: Shot[] = [
  {
    // 1.7 一键入夜：点太阳（浅色）→ 白天铺满；再点月亮回到夜里。
    id: 'night', ms: 7000, pose: 'full', caption: 'night',
    async run(d) {
      await d.cut(async () => { await d.go('/', 400); });
      await d.camera('.theme-toggle', { zoom: 1.6, ms: 600, hold: 200 });
      await d.tap(await d.find('.theme-toggle .segment-item', { index: 1 }), { after: 1900 });
      await d.tap(await d.find('.theme-toggle .segment-item', { index: 0 }), { after: 1900 });
      await d.camera(null, { ms: 600 });
    },
  },
  {
    // 1.8 弹指之间：语言轮往后拨两种，再回到访客自己的语言；字化灰、吹散、重生。
    id: 'ash', ms: 7600, pose: 'full', caption: 'ash',
    async run(d) {
      const own = Math.max(0, LANDING_LOCALES.indexOf(d.locale));
      const order = [(own + 1) % LANDING_LOCALES.length, (own + 2) % LANDING_LOCALES.length, own];
      for (const index of order) {
        await d.tap(`.locale-wheel .wheel-item[data-wheel-index="${index}"]`, { after: 2300, travel: 300 });
      }
    },
  },
];
