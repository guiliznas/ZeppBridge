/*
 * 新手引导的状态机（全局单例）。章节和步骤是 lib/tour/chapters.ts 的数据，界面是
 * components/tour/TourOverlay.vue（聚光框 + 玻璃说明卡）和 TourWelcome.vue（第一屏语言轮）。
 *
 * 一步 = 必要时换页 → 等目标元素出现（最多几秒，等不到就退成居中说明卡，不卡住）→ 滚到视野里
 * → 量出它的位置交给聚光框。窗口尺寸变化、滚动时重量。
 */
import { computed, ref, shallowRef } from 'vue';
import router from '../router';
import { INLINE_CHAPTERS, TOUR_STEPS, type TourChapterId, type TourStep } from '../lib/tour/chapters';
import { enterSandbox, inSandbox, leaveSandbox, markSeen, sandboxFlags, seenChapters } from '../lib/tour/sandbox';
import { locale } from '../i18n';
import { useTheme } from './useTheme';

export type TourMode = 'sandbox' | 'inline';

interface ActiveTour {
  chapters: TourChapterId[];
  chapter: number;
  step: number;
  mode: TourMode;
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
let target: Element | null = null;
let measureFrame = 0;

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

const findTarget = (selector: string, run: number): Promise<Element | null> => new Promise((resolve) => {
  const started = performance.now();
  const tick = () => {
    if (run !== token) return resolve(null);
    const found = [...document.querySelectorAll(selector)].find((element) => element.getClientRects().length > 0) ?? null;
    if (found || performance.now() - started > WAIT_MS) return resolve(found);
    window.setTimeout(tick, 80);
  };
  tick();
});

const measure = () => {
  measureFrame = 0;
  if (!target || !target.isConnected) { box.value = null; return; }
  const rect = target.getBoundingClientRect();
  // 比视口还大的（整张大卡）收到视口里，聚光框不画到屏幕外面去。
  const x = Math.max(rect.left - PAD, 4);
  const y = Math.max(rect.top - PAD, 4);
  const right = Math.min(rect.right + PAD, window.innerWidth - 4);
  const bottom = Math.min(rect.bottom + PAD, window.innerHeight - 4);
  box.value = { x, y, width: Math.max(right - x, 0), height: Math.max(bottom - y, 0) };
};
const scheduleMeasure = () => {
  if (!measureFrame && target) measureFrame = requestAnimationFrame(measure);
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
  target = null;
  box.value = null;
  if (step.route && router.currentRoute.value.path !== step.route) await router.push(step.route).catch(() => undefined);
  const found = step.target ? await findTarget(step.target, run) : null;
  if (run !== token) return;
  if (found) {
    found.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
    // 平滑滚动大约 300ms；滚完再量，聚光框一次落到位，不追着滚动跑。
    await new Promise((resolve) => window.setTimeout(resolve, reducedMotion() ? 0 : 360));
    if (run !== token) return;
    target = found;
    measure();
  }
  settling.value = false;
};

const finish = (completed: boolean) => {
  const tour = active.value;
  if (!tour) return;
  // 跳过整套引导：就地的首次提示也一并算看过；跳过某个就地提示只算它自己。
  const ids: string[] = completed || tour.mode === 'inline' ? [...tour.chapters] : [...tour.chapters, ...INLINE_CHAPTERS];
  // 看完训练计划那一章，第一次进计划页就不必再圈一遍。
  if (tour.chapters.includes('plan')) ids.push('planFirst');
  markSeen(ids);
  token += 1;
  target = null;
  box.value = null;
  active.value = null;
  listen(false);
  if (tour.mode === 'sandbox') leaveSandbox(sandboxFlags()?.ret ?? '/');
};

export const startTour = (chapters: TourChapterId[], mode: TourMode): void => {
  const list = chapters.filter((id) => TOUR_STEPS[id]?.length);
  if (!list.length) return;
  if (!active.value) listen(true);
  active.value = { chapters: list, chapter: 0, step: 0, mode };
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

/** 第一次碰到某个功能：没看过就就地圈一下。沙盒里、或者别的引导正在跑时不插队。 */
export const offerInline = (chapter: TourChapterId): void => {
  if (active.value || inSandbox() || welcomeOpen.value) return;
  if (seenChapters().has(chapter)) return;
  startTour([chapter], 'inline');
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
