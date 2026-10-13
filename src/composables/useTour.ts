/*
 * 新手引导的状态机（全局单例）。章节和步骤是 lib/tour/chapters.ts 的数据，界面是
 * components/tour/TourOverlay.vue（聚光框 + 玻璃说明卡）和 TourWelcome.vue（第一屏语言轮）。
 *
 * 一步 = 必要时换页 → 等目标元素出现（最多几秒，等不到就退成居中说明卡，不卡住）→ 滚到视野里
 * → 量出它的位置交给聚光框。窗口尺寸变化、滚动时重量。
 */
import { computed, getCurrentInstance, ref, shallowRef } from 'vue';
import router from '../router';
import { FULL_TOUR, INLINE_CHAPTERS, TOUR_STEPS, type TourChapterId, type TourStep } from '../lib/tour/chapters';
import { enterSandbox, leaveSandbox, markSeen, sandboxFlags, seenChapters } from '../lib/tour/sandbox';
import { locale } from '../i18n';
import { useTheme } from './useTheme';

export type TourMode = 'sandbox' | 'inline';

interface ActiveTour {
  chapters: TourChapterId[];
  chapter: number;
  step: number;
  mode: TourMode;
  /** 就地提示是在哪一页出的：换了页就收起（它说的那样东西已经不在眼前了）。 */
  path: string;
}

export interface TargetBox { x: number; y: number; width: number; height: number }

const active = shallowRef<ActiveTour | null>(null);
/** 当前这一步圈住的地方；null = 没有目标（居中说明卡）或还在找。 */
const box = shallowRef<TargetBox | null>(null);
/** 正在换页 / 找目标：说明卡先别动。 */
const settling = ref(false);
/** 沙盒的第一屏（语言轮）还开着。 */
const welcomeOpen = ref(false);

const WAIT_MS = 4000;
const PAD = 8;
let token = 0;
/** 当前这一步圈住的元素（`all` 的步骤是一组）。 */
let targets: Element[] = [];
let measureFrame = 0;

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

const findTargets = (selector: string, all: boolean, run: number): Promise<Element[]> => new Promise((resolve) => {
  const started = performance.now();
  const tick = () => {
    if (run !== token) return resolve([]);
    // 换页时旧页面在离场动画里还挂着（KeepAlive + Transition），上面也可能有同名元素：跳过它们。
    const visible = [...document.querySelectorAll(selector)]
      .filter((element) => element.getClientRects().length > 0 && !element.closest('[class*="-leave-active"]'));
    const found = all ? visible : visible.slice(0, 1);
    if (found.length || performance.now() - started > WAIT_MS) return resolve(found);
    window.setTimeout(tick, 80);
  };
  tick();
});

const measure = () => {
  measureFrame = 0;
  const live = targets.filter((element) => element.isConnected);
  if (!live.length) {
    // 圈住的东西被换掉了（页面重渲染）：重新找一次，找不到就退成居中卡，不会反复来。
    box.value = null;
    targets = [];
    if (active.value && !settling.value) void show();
    return;
  }
  const rects = live.map((element) => element.getBoundingClientRect());
  const rect = {
    left: Math.min(...rects.map((r) => r.left)), top: Math.min(...rects.map((r) => r.top)),
    right: Math.max(...rects.map((r) => r.right)), bottom: Math.max(...rects.map((r) => r.bottom)),
  };
  // 比视口还大的（整张大卡）收到视口里，聚光框不画到屏幕外面去。
  const x = Math.max(rect.left - PAD, 4);
  const y = Math.max(rect.top - PAD, 4);
  const right = Math.min(rect.right + PAD, window.innerWidth - 4);
  const bottom = Math.min(rect.bottom + PAD, window.innerHeight - 4);
  box.value = { x, y, width: Math.max(right - x, 0), height: Math.max(bottom - y, 0) };
};
const scheduleMeasure = () => {
  if (!measureFrame && targets.length) measureFrame = requestAnimationFrame(measure);
};

const listen = (on: boolean) => {
  const method = on ? 'addEventListener' : 'removeEventListener';
  window[method]('resize', scheduleMeasure);
  document[method]('scroll', scheduleMeasure, { capture: true, passive: true } as AddEventListenerOptions);
};

const stepOf = (tour: ActiveTour): TourStep | undefined => TOUR_STEPS[tour.chapters[tour.chapter]]?.[tour.step];

const show = async () => {
  const tour = active.value;
  const step = tour && stepOf(tour);
  if (!tour || !step) return;
  const run = ++token;
  settling.value = true;
  targets = [];
  box.value = null;
  if (step.route && router.currentRoute.value.path !== step.route) await router.push(step.route).catch(() => undefined);
  const found = step.target ? await findTargets(step.target, step.all === true, run) : [];
  if (run !== token) return;
  if (found.length) {
    found[0].scrollIntoView({ block: 'center', inline: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
    // 平滑滚动大约 300ms；滚完再量，聚光框一次落到位，不追着滚动跑。
    await new Promise((resolve) => window.setTimeout(resolve, reducedMotion() ? 0 : 360));
    if (run !== token) return;
    targets = found;
    measure();
  }
  settling.value = false;
};

const finish = (completed: boolean) => {
  const tour = active.value;
  if (!tour) return;
  // 跳过整套引导：就地的首次提示也一并算看过（不想被打扰）；跳过单章、某个就地提示只算它自己。
  const wholeTour = FULL_TOUR.every((id) => tour.chapters.includes(id));
  const ids: string[] = !completed && wholeTour ? [...tour.chapters, ...INLINE_CHAPTERS] : [...tour.chapters];
  // 看完训练计划那一章，第一次进计划页就不必再圈一遍。
  if (tour.chapters.includes('plan')) ids.push('planFirst');
  markSeen(ids);
  token += 1;
  targets = [];
  box.value = null;
  active.value = null;
  listen(false);
  if (tour.mode === 'sandbox') leaveSandbox(sandboxFlags()?.ret ?? '/');
};

router.afterEach((to) => {
  const tour = active.value;
  if (tour?.mode === 'inline' && to.path !== tour.path) finish(false);
});

export const startTour = (chapters: TourChapterId[], mode: TourMode): void => {
  const list = chapters.filter((id) => TOUR_STEPS[id]?.length);
  if (!list.length) return;
  if (!active.value) listen(true);
  active.value = { chapters: list, chapter: 0, step: 0, mode, path: router.currentRoute.value.path };
  void show();
};

/** 进示例沙盒看这几章（整页重新载入，见 lib/tour/sandbox.ts）。`ret`：看完回哪一页。 */
export const launchSandbox = (chapters: TourChapterId[], options: { welcome?: boolean; ret?: string } = {}): void => {
  const first = chapters.map((id) => TOUR_STEPS[id]?.[0]?.route).find(Boolean);
  enterSandbox({
    chapters,
    welcome: options.welcome,
    ret: options.ret ?? router.currentRoute.value.fullPath,
    route: first ?? '/',
    theme: useTheme().themeMode.value,
    locale: locale.value,
  });
};

/** 第一次碰到某个功能：没看过就就地圈一下。沙盒里、别的引导正在跑时不插队；落地页的演示
    （也是演示模式）不出——整屏的引导层会挡住那边自己编排的演示。 */
export const offerInline = (chapter: TourChapterId): void => {
  if (active.value || window.__ZB_DEMO__?.demo || welcomeOpen.value) return;
  if (seenChapters().has(chapter)) return;
  startTour([chapter], 'inline');
};

/** 等界面摊开（`delay` 毫秒）再提示；到点时调用它的组件已经卸载 / 被 KeepAlive 收起，或者
    `stillThere()` 说那样东西已经关了，就不出——免得提示浮在别的页面上。 */
export const offerInlineSoon = (chapter: TourChapterId, delay: number, stillThere: () => boolean = () => true): void => {
  const instance = getCurrentInstance();
  window.setTimeout(() => {
    if (instance && (instance.isUnmounted || instance.isDeactivated)) return;
    if (stillThere()) offerInline(chapter);
  }, delay);
};

const move = (delta: 1 | -1) => {
  const tour = active.value;
  if (!tour) return;
  let { chapter, step } = tour;
  step += delta;
  if (step >= TOUR_STEPS[tour.chapters[chapter]].length) { chapter += 1; step = 0; }
  if (step < 0) {
    if (chapter === 0) return;
    chapter -= 1;
    step = TOUR_STEPS[tour.chapters[chapter]].length - 1;
  }
  if (chapter >= tour.chapters.length) { finish(true); return; }
  active.value = { ...tour, chapter, step };
  void show();
};

export const useTour = () => ({
  active,
  box,
  settling,
  welcomeOpen,
  current: computed(() => {
    const tour = active.value;
    if (!tour) return null;
    const steps = TOUR_STEPS[tour.chapters[tour.chapter]];
    const total = tour.chapters.reduce((sum, id) => sum + TOUR_STEPS[id].length, 0);
    const done = tour.chapters.slice(0, tour.chapter).reduce((sum, id) => sum + TOUR_STEPS[id].length, 0) + tour.step;
    return {
      chapter: tour.chapters[tour.chapter],
      step: tour.step,
      stepsInChapter: steps.length,
      index: done,
      total,
      first: done === 0,
      last: done === total - 1,
      mode: tour.mode,
    };
  }),
  next: () => move(1),
  prev: () => move(-1),
  /** 跳过：这几章连同就地的首次提示都算看过，别再打扰。 */
  skip: () => finish(false),
});
