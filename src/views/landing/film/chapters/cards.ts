import type { Director } from '../director';
import type { Shot } from '../types';
import { tapNth } from './look';

const TABLE = '.card-table';
const DAY = `${TABLE} button.pcard.day:not(.disabled)`;
const MONTH = `${TABLE} button.pcard.month:not(.empty)`;
const WEEK = `${TABLE} button.pcard.week:not(.empty)`;
const BOX = '#card-collection-box:not(.empty)';

/** 从概览的睡眠卡进睡眠页，再点「挑几天交给 AI」打开牌桌（默认 7 天，发牌）。 */
export const openTable = async (d: Director) => {
  await d.go('/', 300);
  await d.tap('.sleep-panel', { after: 900, travel: 1 });
  await d.tap('button.pick-days', { after: 300, travel: 1 });
  await d.find(`${TABLE} .segment-item`);
};

/** 把一张牌拖到另一张上（叠成一叠）。 */
const pileOnto = async (d: Director, from: HTMLElement, onto: HTMLElement) => {
  const a = d.center(from), b = d.center(onto);
  await d.drag(from, { x: b.x - a.x, y: b.y - a.y }, { ms: 700, settle: 650, grab: 200 });
};

/** 第一章 外观后半：扑克牌（本片高潮）、设置大卡、交给 AI 线条卡（计划 1.4–1.6）。 */
export const lookCards: Shot[] = [
  {
    // 1.4 一叠光阴：7 天发牌 → 6 个月 → 点进十月（月牌收角、周牌展开）→ 点进一周 → 翻面送进箱子
    //     → 两张叠成一叠、长按整叠飞进箱子 → 打开收集箱、往上甩掉一张 → 清空。
    id: 'poker', ms: 30000, pose: 'full', caption: 'poker',
    async run(d) {
      await d.cut(() => openTable(d));
      await d.wait(1500);
      await tapNth(d, `${TABLE} .segment-item`, 2, 1500);
      d.rate(0.6);
      try {
        await d.tap(await d.find(MONTH, { index: 5 }), { after: 1700 });
        await d.tap(await d.find(WEEK, { index: 1 }), { after: 1700 });
      } finally { d.rate(1); }
      const day = await d.find(DAY, { index: 1 });
      await d.camera(day, { zoom: 1.6, ms: 700, hold: 200 });
      await d.tap(day, { after: 900 });
      await d.tap(`${TABLE} .pcard.confirm .back-send`, { after: 1300 });
      await d.camera(null, { ms: 600, hold: 100 });
      const days = d.all(DAY);
      if (days.length >= 4) {
        await pileOnto(d, days[days.length - 1]!, days[days.length - 2]!);
        await pileOnto(d, days[days.length - 3]!, days[days.length - 2]!);
        await d.hold(days[days.length - 2]!, 650, { after: 1400 });
      }
      await d.tap(BOX, { after: 1500 });
      await d.camera('.box-spread .hand', { zoom: 1.35, ms: 700, hold: 200 });
      const cards = d.all('.box-spread .hand-card');
      if (cards.length > 1) await d.drag(cards[cards.length - 1]!, { x: 0, y: -320 }, { flick: true, ms: 240, settle: 900, grab: 160 });
      await d.camera(null, { ms: 600, hold: 100 });
      await d.tap('.box-spread .spread-foot .foot-button', { after: 1700 });
      await d.clear();
    },
  },
  {
    // 1.5 设置大卡：小卡叠（cover）→ 展开全部成大卡 → 点开一张 → 收回原位。
    id: 'deck', ms: 9000, pose: 'full', caption: 'deck',
    async run(d) {
      await d.cut(async () => {
        await d.go('/settings', 400);
        if (d.all('.deck-collapse').length) await d.tap('.deck-collapse', { after: 900, travel: 1 });
      });
      await d.wait(700);
      await d.tap('.deck-unbox', { after: 1500 });
      await d.tap(await d.find('button.list-open', { index: 2 }), { after: 1600 });
      await d.tap('.deck-close', { after: 1400 });
    },
  },
  {
    // 1.6 交给 AI 的线条卡：拖开一张、松手回弹（旁边的被碰开），点开一张浮起来。
    id: 'lines', ms: 9000, pose: 'full', caption: 'lines',
    async run(d) {
      await d.cut(async () => { await d.go('/ai', 900); });
      const slots = d.all('.slot-button');
      if (slots.length >= 3) {
        await d.drag(slots[1]!, { x: 150, y: 70 }, { ms: 700, settle: 1100, grab: 200 });
        await d.drag(slots[2]!, { x: -120, y: -60 }, { ms: 600, settle: 1100, grab: 200 });
        await d.tap(slots[0]!, { after: 1800 });
        await d.escape(500);
      }
    },
  },
];
