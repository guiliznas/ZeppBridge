import { SPEED, type Director } from '../director';
import type { Chapter, Shot } from '../types';
import { FILM_SCRIPT, filmLocale } from '../copy';
import { lookIntro, prologue } from './look';
import { lookCards, openTable } from './cards';
import { finale } from './settings';

/**
 * 一分钟短片（10-14 用户：发社交平台，节奏和转场照样片）。只留两样最大的特色：
 * ① 视觉动效——玻璃、卡↔页形变、牌墙与扑克牌、交给 AI 线条卡、设置大卡；
 * ② 训练计划——把身体状况连同记录发给 AI → AI 排好一周 → 电脑上定稿、手表上开练。
 * 切点落在 120 BPM 的拍子上（每镜都是 0.5 秒的整数倍），整片 59 秒；配乐换曲只要换拍子。
 * 网站开场放的也是这一版；完整长版用 `?cut=full`。
 */
const TABLE = '.card-table';
const DAY = `${TABLE} button.pcard.day:not(.disabled)`;
const MONTH = `${TABLE} button.pcard.month:not(.empty)`;
const WEEK = `${TABLE} button.pcard.week:not(.empty)`;
const BOX = '#card-collection-box:not(.empty)';
const SEND = 'button.lock:not(:disabled)';

const shot = (list: Shot[], id: string): Shot => {
  const found = list.find((item) => item.id === id);
  if (!found) throw new Error(`Film shot missing: ${id}`);
  return found;
};
/** 沿用长版的一镜，只改时长（和姿态 / 字幕）。 */
const reuse = (list: Shot[], id: string, ms: number, extra: Partial<Shot> = {}): Shot => ({ ...shot(list, id), ms, ...extra });

/**
 * 展示墙：窗口侧转着浮在光晕上，整镜慢慢转回来，镜头同时缓缓推近。
 * 墙盖着应用，`warm` 趁这时在底下把后面要切去的页先走一遍——第一次进「交给 AI」、设置页要一两秒，
 * 不预热的话换场时只剩光晕和字幕干等。
 */
const wall = (id: string, kind: 'glass' | 'cards', caption: Shot['caption'], ms: number, warm: string[] = []): Shot => ({
  id, ms, pose: 'tilt', caption,
  async run(d) {
    await d.cut(async () => { await d.wall(kind); });
    void d.pose('tiltBack', (ms - 400) * SPEED);
    await d.wait(500);
    const push = d.camera(d.all(`.film-wall.${kind} .wall-row`), { zoom: 1.16, fill: 1, ms: ms - 1200, hold: ms - 1200 });
    for (const path of warm) await d.go(path, 0);
    await push;
  },
});

const pileOnto = async (d: Director, from: HTMLElement, onto: HTMLElement) => {
  const a = d.center(from), b = d.center(onto);
  await d.drag(from, { x: b.x - a.x, y: b.y - a.y }, { ms: 480, settle: 380, grab: 140 });
};

export const short: Chapter = {
  id: 'short',
  label: 'tagline',
  shots: [
    reuse(prologue.shots, 'tagline', 2500),
    wall('glass', 'glass', 'glass', 4000, ['/ai', '/settings']),
    reuse(lookIntro, 'morph', 4000),
    wall('deckwall', 'cards', 'poker', 3000),
    {
      // 一层层展开：6 个月 → 点进一月（月牌收到左上角、周牌展开）→ 点进一周（日牌展开）。
      id: 'layers', ms: 6000, pose: 'full', caption: 'poker',
      async run(d) {
        await d.cut(() => openTable(d));
        await d.tap(await d.find(`${TABLE} .segment-item`, { index: 2 }), { after: 500, travel: 240 });
        await d.tap(await d.find(MONTH, { index: 5 }), { after: 600 });
        await d.tap(await d.find(WEEK, { index: 1 }), { after: 500 });
      },
    },
    {
      // 叠成一叠、长按整叠飞进箱子；打开收集箱，一手牌摊开；清空，逐张落下消失（也把箱子收掉，不挡下一镜）。
      id: 'pile', ms: 7500, pose: 'full', caption: 'pile',
      async run(d) {
        const days = d.all(DAY);
        if (days.length >= 3) {
          await pileOnto(d, days[days.length - 1]!, days[days.length - 2]!);
          await d.hold(days[days.length - 2]!, 600, { after: 400 });
        }
        await d.tap(BOX, { after: 600 });
        await d.tap('.box-spread .spread-foot .foot-button', { after: 650 });
      },
    },
    reuse(lookCards, 'lines', 5000),
    reuse(lookCards, 'deck', 4000),
    {
      // 章节卡：训练计划，交给 AI。窗口退场时在后面换到「交给 AI」页，台词换成这一版。
      id: 'planIntro', ms: 1500, pose: 'title', caption: 'planIntro',
      async run(d) {
        d.hidePointer();
        await d.clear();
        await d.go('/ai', 200);
        d.api.script([{ prompt: FILM_SCRIPT[filmLocale(d.locale)].prompt, answer: FILM_SCRIPT[filmLocale(d.locale)].answer }]);
      },
    },
    {
      // 身体怎样，直接告诉它：在自定义问题里一个字一个字写下身体状况。
      id: 'tell', ms: 3500, pose: 'full', caption: 'tell',
      async run(d) {
        await d.camera('.fcard', { zoom: 1.6, fill: 0.85, ms: 500, hold: 100 });
        const field = d.all('.fcard textarea, .fcard input')[0];
        if (field) await d.type(field, FILM_SCRIPT[filmLocale(d.locale)].prompt, { replace: true, perChar: filmLocale(d.locale) === 'zh' ? 34 : 14 });
        await d.camera(null, { ms: 400, hold: 100 });
      },
    },
    {
      // AI 读完记录，排好一周：长按发出 → AI 回一段（附件、思考、回复）→ 计划整理好、复制、接回。
      id: 'chat', ms: 7000, pose: 'full', caption: 'summarize',
      async run(d) {
        d.api.pace(0.16);
        await d.hold(SEND, 1150, { after: 700 }); // BridgeLock 按满 950ms 才发射
        await d.tap('dialog[open] .conversation-send', { after: 200 });
        const dialog = await d.find('dialog[open].demo-conversation') as HTMLDialogElement;
        for (let n = 0; n < 160 && dialog.open && dialog.dataset.state !== 'return'; n++) await d.clock.wait(80);
      },
    },
    {
      // 电脑上定稿，手表上开练：一周计划落到电脑上，窗口让到左边、手表进来；长按发到手表，训练卡飞过去，表盘亮起。
      id: 'toWatch', ms: 6500, pose: 'watch', caption: 'toWatch',
      async run(d) {
        await d.cut(async () => { await d.clear(); d.api.script(null); await d.go('/ai/plan', 200); });
        d.watch('shown');
        await d.wait(700);
        const hold = await d.hold('.main-content .page button.hold-button', 1000, { after: 300 });
        const first = d.all('a.future-day:not(.rest)')[0] ?? hold;
        d.watch('lit', first, 1000);
        await d.wait(1600);
      },
    },
    reuse(finale.shots, 'free', 2000, { async run(d) { d.hidePointer(); d.watch('hidden'); await d.clear(); } }),
    reuse(finale.shots, 'try', 2500),
  ],
};
