import type { PlaybackClock } from '../playback';
import type { DemoPresentation } from '../../../demo/presentation';
import type { Camera, Pose, Shot, Stage } from './types';
import type { CaptionKey } from './copy';
import type { LandingLocale } from '../../../composables/useLandingLocale';

/** 演示应用在窗口里的固定尺寸（CSS 像素）。镜头、指针都用这套坐标。 */
export const APP_W = 1280;
export const APP_H = 800;
/** 推近后目标四周至少留这么多（应用坐标），不再把内容切在框外。 */
const SAFE = 36;

type Target = string | Element;
interface Point { x: number; y: number }

/**
 * 一镜里能做的事。所有等待都走 PlaybackClock：观众暂停、切章、离开页面都能干净地停下。
 * 只通过 `__ZB_PRESENTATION__` 操作应用（真事件、真路由、真动画），不改应用状态的捷径。
 */
export class Director {
  private pointerAt: Point = { x: APP_W / 2, y: APP_H / 2 };
  constructor(readonly view: Window, readonly clock: PlaybackClock, readonly stage: Stage, readonly locale: LandingLocale = 'en') {}

  get api(): DemoPresentation {
    const api = this.view.__ZB_PRESENTATION__;
    if (!api) throw new Error('Demo presentation is not ready');
    return api;
  }
  get doc(): Document { return this.view.document; }

  wait(ms: number) { return this.clock.wait(ms); }

  /** 等一个看得见的元素出现（宽度 > 0）。 */
  async find(selector: string, options: { text?: string; limit?: number; index?: number } = {}): Promise<HTMLElement> {
    const limit = options.limit ?? 12000;
    for (let elapsed = 0; elapsed < limit; elapsed += 80) {
      await this.clock.checkpoint();
      const found = this.all(selector, options.text)[options.index ?? 0];
      if (found) return found;
      await this.wait(80);
    }
    throw new Error(`Film target unavailable: ${selector}${options.text ? ` "${options.text}"` : ''}`);
  }
  all(selector: string, text?: string): HTMLElement[] {
    return [...this.doc.querySelectorAll<HTMLElement>(selector)]
      .filter((el) => el.getBoundingClientRect().width > 0 && (!text || (el.innerText || el.getAttribute('aria-label') || '').includes(text)));
  }
  private async resolve(target: Target, text?: string): Promise<HTMLElement> {
    return typeof target === 'string' ? this.find(target, { text }) : target as HTMLElement;
  }
  center(el: Element): Point { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }

  // ── 指针 ────────────────────────────────────────────────────────────

  /** 指针从当前位置滑到目标（带一点弧线），不按下。 */
  async move(to: Point, ms = 420) {
    const from = { ...this.pointerAt };
    const steps = Math.max(1, Math.round(ms / 16));
    const lift = Math.min(60, Math.hypot(to.x - from.x, to.y - from.y) * 0.12);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, e = t * t * (3 - 2 * t);
      this.pointerAt = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e - Math.sin(Math.PI * t) * lift };
      this.stage.pointer({ ...this.pointerAt, pressed: false, visible: true });
      await this.wait(ms / steps);
    }
  }
  hidePointer() { this.stage.pointer({ ...this.pointerAt, pressed: false, visible: false }); }

  /** 点一下：指针过去、按下涟漪、真 click。`after` 是点完留给应用的反应时间。 */
  async tap(target: Target, options: { text?: string; after?: number; travel?: number } = {}) {
    const el = await this.resolve(target, options.text);
    const at = this.center(el);
    await this.move(at, options.travel ?? 380);
    this.stage.pointer({ ...at, pressed: true, visible: true });
    this.api.click(el);
    await this.wait(140);
    this.stage.pointer({ ...at, pressed: false, visible: true });
    await this.wait(options.after ?? 650);
    return el;
  }

  /** 长按：指针上出进度环，`ms` 之后松开（牌桌 450ms、发到手表等）。 */
  async hold(target: Target, ms = 650, options: { text?: string; after?: number } = {}) {
    const el = await this.resolve(target, options.text);
    const at = this.center(el);
    await this.move(at);
    this.api.pointer(el, 'pointerdown', at.x, at.y);
    this.stage.pointer({ ...at, pressed: true, visible: true, hold: ms });
    try { await this.wait(ms); } finally {
      this.api.pointer(el, 'pointerup', at.x, at.y);
      this.stage.pointer({ ...at, pressed: false, visible: true });
    }
    await this.wait(options.after ?? 700);
    return el;
  }

  /**
   * 按住拖动（缓入缓出）。`flick`：末段加速，松手瞬间速度够大（甩出去）；
   * `roundTrip`：拖出去再回到原处才松手（玻璃条上让透镜滑一趟，不真的换选项）。
   */
  async drag(target: Target, by: Point, options: { text?: string; ms?: number; settle?: number; flick?: boolean; roundTrip?: boolean; grab?: number } = {}) {
    const el = await this.resolve(target, options.text);
    const from = this.center(el);
    await this.move(from);
    this.api.pointer(el, 'pointerdown', from.x, from.y);
    this.stage.pointer({ ...from, pressed: true, visible: true });
    let end = from;
    try {
      await this.wait(options.grab ?? 260);
      const ms = options.ms ?? 900;
      const steps = Math.max(2, Math.ceil(ms / 16));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const e = options.roundTrip ? Math.sin(Math.PI * t) : options.flick ? t * t * t : (1 - Math.cos(Math.PI * t)) / 2;
        end = { x: from.x + by.x * e, y: from.y + by.y * e };
        this.api.pointer(el, 'pointermove', end.x, end.y);
        this.pointerAt = end;
        this.stage.pointer({ ...end, pressed: true, visible: true });
        await this.wait(ms / steps);
      }
      if (!options.flick) await this.wait(220);
      this.api.pointer(el, 'pointerup', end.x, end.y);
    } catch (error) {
      this.api.pointer(el, 'pointercancel', end.x, end.y);
      throw error;
    }
    this.stage.pointer({ ...end, pressed: false, visible: true });
    await this.wait(options.settle ?? 800);
    return el;
  }

  // ── 应用 ────────────────────────────────────────────────────────────

  async go(path: string, settle = 650) {
    await this.clock.checkpoint();
    await this.api.go(path);
    await this.find('.main-content');
    const main = this.doc.querySelector<HTMLElement>('.main-content');
    if (main) main.scrollTop = 0;
    await this.wait(settle);
  }
  async escape(after = 450) { this.api.escape(); await this.wait(after); }
  /** 关掉所有浮层、牌桌、收集箱，回到干净的页面（章首、跳章时用）。 */
  async clear() {
    for (let n = 0; n < 5 && this.doc.querySelector('[data-modal-dialog], .card-table, .box-spread, .anchored-popover, dialog[open]'); n++) await this.escape(380);
  }
  /** 应用里的主滚动区平滑滚到元素（缓出），元素上缘落在 `top` 处。 */
  async scrollTo(target: Target, top = 90, ms = 520) {
    const el = await this.resolve(target);
    const main = this.doc.querySelector<HTMLElement>('.main-content');
    if (!main || !main.contains(el)) return;
    const start = main.scrollTop, end = Math.max(0, start + el.getBoundingClientRect().top - main.getBoundingClientRect().top - top);
    const steps = Math.max(1, Math.round(ms / 16));
    for (let i = 1; i <= steps; i++) { main.scrollTop = start + (end - start) * (1 - (1 - i / steps) ** 3); await this.wait(ms / steps); }
  }
  /** 放慢应用里的动画（只影响 Web Animations / CSS 动画）。 */
  rate(value: number) { this.api.rate(value); }

  // ── 镜头与舞台 ──────────────────────────────────────────────────────

  /**
   * 推到某个元素：按它的大小选倍率（`zoom` 是上限），并夹在安全框里——目标完整入画，画面不露窗外。
   * 传 null 拉回全景。
   */
  async camera(target: Target | null, options: { zoom?: number; ms?: number; fill?: number; hold?: number } = {}) {
    const ms = options.ms ?? 900;
    if (target === null) { this.stage.camera({ x: 0, y: 0, zoom: 1 }, ms); await this.wait(options.hold ?? ms); return; }
    const el = await this.resolve(target);
    const r = el.getBoundingClientRect();
    const fill = options.fill ?? 0.62;
    const fit = Math.min((APP_W * fill) / (r.width + SAFE * 2), (APP_H * fill) / (r.height + SAFE * 2));
    const zoom = Math.max(1, Math.min(options.zoom ?? 2.2, fit));
    this.stage.camera(frame(r, zoom), ms);
    await this.wait(options.hold ?? ms);
  }
  pose(next: Pose, ms = 900) { this.stage.pose(next, ms); return this.wait(ms); }
  /** 硬切：黑一下，期间做 `setup`（换页、开牌桌），再亮起来。镜头同时复位。 */
  async cut(setup: () => Promise<void>, ms = 140) {
    this.stage.veil(true, ms); this.hidePointer(); await this.wait(ms);
    this.stage.camera({ x: 0, y: 0, zoom: 1 }, 0);
    await setup();
    this.stage.veil(false, ms + 80); await this.wait(ms);
  }
  caption(key: CaptionKey | null) { this.stage.caption(key); }
}

/** 让矩形 `r` 的中心尽量落在画面中央，但不让画面露出应用之外。 */
export const frame = (r: { x: number; y: number; width: number; height: number }, zoom: number): Camera => {
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  const x = Math.min(0, Math.max(APP_W * (1 - zoom), APP_W / 2 - cx * zoom));
  const y = Math.min(0, Math.max(APP_H * (1 - zoom), APP_H / 2 - cy * zoom));
  return { x, y, zoom };
};

export interface ShotTiming { chapter: string; shot: string; planned: number; actual: number }

/** 放一镜：先摆姿态、上字幕，做完动作后补足到计划时长；回报实际用时（录片和调节奏时看哪一镜超了）。 */
export async function playShot(chapter: string, shot: Shot, director: Director, onShot?: (timing: ShotTiming) => void) {
  const start = director.clock.elapsed();
  director.stage.shot(chapter, shot.id);
  if (shot.pose) director.stage.pose(shot.pose, 900);
  if (shot.caption !== undefined) director.caption(shot.caption);
  await shot.run(director);
  const used = director.clock.elapsed() - start;
  if (used < shot.ms) await director.wait(shot.ms - used);
  onShot?.({ chapter, shot: shot.id, planned: shot.ms, actual: Math.round(Math.max(used, shot.ms)) });
}
