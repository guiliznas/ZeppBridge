/*
 * 新手引导的章节与步骤（纯数据，脚本见桌面《计划.md》二·2 的草稿）。
 *
 * 每一步圈住页面上的一样东西：`target` 是 CSS 选择器（多数页面元素已有稳定的类名，个别补了
 * data-tour），`route` 是这一步要在哪一页。没有 target 的步骤是居中的一张说明卡。
 * 文案在 components/tour/tour.i18n.ts，按 `<章>.<步>` 取。
 *
 * 两种跑法：
 *   - sandbox：完整引导、设置里点开的单章。整页重新载入成示例沙盒（?demo=1&tour=…），
 *     后端换成演示运行时，真实库碰不到（lib/tour/sandbox.ts）。
 *   - inline：第一次碰到牌桌、收集箱、寄出前检查、训练计划时，就地在真实界面上圈一下，
 *     不重载、不打断手上的事；引导本身不写库。取代以前的 CoachTip。
 */

export interface TourStep {
  /** 页面上圈住的元素；null = 居中说明卡。 */
  target: string | null;
  /** 这一步在哪一页；省略 = 留在当前页。 */
  route?: string;
}

/** 完整引导按这个顺序走。 */
export const FULL_TOUR = ['basics', 'connect', 'overview', 'detail', 'pick', 'handoff', 'plan', 'settings'] as const;
/** 就地出现、每章只自动出现一次的。 */
export const INLINE_CHAPTERS = ['cards', 'box', 'check', 'planFirst'] as const;

export type FullChapterId = (typeof FULL_TOUR)[number];
export type InlineChapterId = (typeof INLINE_CHAPTERS)[number];
export type TourChapterId = 'whatsnew' | FullChapterId | InlineChapterId;

export const TOUR_STEPS: Record<TourChapterId, TourStep[]> = {
  whatsnew: [
    { route: '/', target: '.pins' },
    // 宽屏是顶栏导航胶囊，窄屏是底部导航；哪个看得见圈哪个。
    { route: '/', target: '.pill-nav .segment-item[data-value="/ai"], .bottom-track .segment-item[data-value="/ai"]' },
    { route: '/ai/plan', target: '.ai-plan-week .bridge-future' },
    { route: '/settings/ai', target: '.deck-stage .open-card' },
    { route: '/settings/account', target: '.deck-stage .open-card' },
  ],
  basics: [
    { route: '/', target: '.theme-toggle' },
    { route: '/', target: '.locale-wheel' },
  ],
  connect: [
    { route: '/settings/account', target: '.deck-stage .open-card' },
    { route: '/settings/sync', target: '.deck-stage .open-card' },
  ],
  overview: [
    { route: '/', target: '.pins' },
    { route: '/', target: '.pins .baseline-tag' },
    { route: '/', target: '.overview-focus' },
  ],
  detail: [
    { route: '/heart', target: '.range-bar' },
    { route: '/heart', target: '.missing-row' },
  ],
  pick: [
    { route: '/heart', target: '.pick-days' },
    { route: '/heart', target: null },
  ],
  handoff: [
    { route: '/ai', target: '.ai-stage-page .cloud' },
    { route: '/ai', target: '.ai-stage-page .stage' },
  ],
  plan: [
    { route: '/ai/plan', target: '.ai-plan-week .future-days' },
    { route: '/ai/plan', target: '.ai-plan-week .future-day' },
    { route: '/ai/plan', target: '.ai-plan-week .hold-button' },
  ],
  settings: [
    { route: '/settings/archive', target: '.deck-stage .open-card' },
    { route: '/settings/ai', target: '.deck-stage .open-card' },
    { route: '/settings/guide', target: '.deck-stage .open-card' },
  ],
  // 牌桌、铺开的收集箱本身占满一屏：圈它没有意义，就是一张居中的说明卡。
  cards: [{ target: null }],
  box: [{ target: null }],
  check: [{ target: '.ai-sub-page.story .check-grid' }],
  planFirst: [{ target: '.ai-plan-week .future-days' }],
};

export const isFullChapter = (id: string): id is FullChapterId => (FULL_TOUR as readonly string[]).includes(id);
export const isTourChapter = (id: string): id is TourChapterId => id in TOUR_STEPS;
