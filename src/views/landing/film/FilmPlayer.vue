<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { PlaybackClock } from '../playback';
import { useShowcase } from '../useShowcase';
import { Director, playShot, type ShotTiming } from './director';
import { pickFilm } from './chapters';
import { FILM_SCRIPT, filmCaption, filmLocale, type CaptionKey } from './copy';
import type { Camera, Pose, WatchState } from './types';
import type { LandingLocale } from '../../../composables/useLandingLocale';
import watchImage from '../../../assets/devices/amazfit-balance-2.webp';

/**
 * 网站开场即宣传片（计划第三、四节）。真应用跑在 iframe 里（演示模式、合成数据），导演层照时间线操作它；
 * 外面这层只做舞台：光晕底、窗口姿态、镜头、字幕、指针、手表道具。录对外视频时用的是同一个组件（?film=record）。
 * 只有中、英两版：字幕和 iframe 里的界面用同一种语言（filmLocale），切语言时 iframe 跟着重载。
 */
const props = defineProps<{ locale: LandingLocale; record?: boolean }>();
const emit = defineEmits<{ done: []; skip: [] }>();

const FILM = pickFilm(location.search);
const lang = computed(() => filmLocale(props.locale));
const root = ref<HTMLElement | null>(null);
const stageEl = ref<HTMLElement | null>(null);
const frame = ref<HTMLIFrameElement | null>(null);
const propEl = ref<HTMLElement | null>(null);
const windowEl = ref<HTMLElement | null>(null);
const cameraEl = ref<HTMLElement | null>(null);
const veilEl = ref<HTMLElement | null>(null);
const flyerEl = ref<HTMLElement | null>(null);
const scale = ref(1);
const src = ref('');
const ready = ref(false), failed = ref(false), finished = ref(false);
const caption = ref<CaptionKey | null>(null);
const pose = ref<Pose>('title');
const zoom = ref(1);
const watchState = ref<WatchState>('hidden');
const cursor = ref({ x: 640, y: 400, pressed: false, visible: false, hold: 0, holdKey: 0 });
const active = ref({ chapter: FILM[0]!.id, shot: '' });
const show = useShowcase(root);
const text = computed(() => (caption.value ? filmCaption(lang.value, caption.value) : null));
const script = computed(() => FILM_SCRIPT[lang.value]);
/** 标题逐字（中文）/ 逐词（西文）模糊入焦，像样片里的大字。 */
const glyphs = computed(() => {
  const title = text.value?.title ?? '';
  return lang.value === 'zh' ? [...title] : title.split(/(\s+)/).filter(Boolean);
});

let controller: AbortController | undefined, clock: PlaybackClock | undefined, resize: ResizeObserver | undefined;
let generation = 0;
const EASE = 'cubic-bezier(.22,1,.36,1)';
/* 1920×1080 舞台上窗口（1280×800 的应用）的落点；`r` 是绕窗口中心的侧转（rotateY, rotateX）。 */
const POSES: Record<Pose, { x: number; y: number; s: number; o: number; r?: [number, number] }> = {
  full: { x: 256, y: 44, s: 1.1, o: 1 },
  right: { x: 610, y: 150, s: 0.94, o: 1 },
  left: { x: 106, y: 150, s: 0.94, o: 1 },
  title: { x: 320, y: 200, s: 1, o: 0 },
  tilt: { x: 256, y: 60, s: 1.06, o: 1, r: [-13, 6] },
  tiltBack: { x: 256, y: 50, s: 1.09, o: 1, r: [7, -3] },
  watch: { x: 96, y: 150, s: 0.84, o: 1 },
};
/* 每个姿态都用同一串变换函数，WAAPI 才能逐项插值（侧转不会在中途翻成矩阵乱转）。 */
const poseTransform = (p: Pose) => {
  const { x, y, s, r = [0, 0] } = POSES[p];
  return `translate(${x}px, ${y}px) scale(${s}) translate(640px, 400px) perspective(2600px) rotateY(${r[0]}deg) rotateX(${r[1]}deg) translate(-640px, -400px)`;
};
const animateTo = (el: HTMLElement | null, keyframe: Keyframe, ms: number, from?: Keyframe) => {
  if (!el) return;
  if (ms <= 0 || (!props.record && show.reduced.value)) { el.getAnimations().forEach((animation) => animation.cancel()); Object.assign(el.style, keyframe); return; }
  const start: Keyframe = from ?? {};
  if (!from) {
    const style = getComputedStyle(el);
    for (const key of Object.keys(keyframe)) (start as Record<string, string>)[key] = style.getPropertyValue(key);
  }
  el.getAnimations().forEach((animation) => animation.cancel());
  Object.assign(el.style, keyframe);
  el.animate([start, keyframe], { duration: ms, easing: EASE });
};
/** 应用坐标（iframe 里的 CSS 像素）→ 舞台坐标：iframe 的外框已经带上了窗口姿态和镜头。 */
const toStage = (point: { x: number; y: number }) => {
  const box = frame.value?.getBoundingClientRect(), stage = stageEl.value?.getBoundingClientRect();
  if (!box || !stage) return { x: 0, y: 0 };
  return { x: (box.left + point.x * (box.width / 1280) - stage.left) / scale.value, y: (box.top + point.y * (box.height / 800) - stage.top) / scale.value };
};
/** 表盘中心在舞台上的位置（和 film.css 里 .film-watch 的摆放对应）。 */
const FACE = { x: 1590, y: 548 };

const stage = {
  camera(next: Camera, ms: number) {
    zoom.value = next.zoom;
    animateTo(cameraEl.value, { transform: `translate(${next.x}px, ${next.y}px) scale(${next.zoom})` }, ms);
  },
  pose(next: Pose, ms: number) {
    pose.value = next;
    animateTo(windowEl.value, { transform: poseTransform(next), opacity: String(POSES[next].o) }, ms);
  },
  caption(key: CaptionKey | null) { caption.value = key; },
  pointer(state: { x: number; y: number; pressed: boolean; visible: boolean; hold?: number }) {
    const hold = state.hold ?? 0;
    cursor.value = { ...state, hold, holdKey: hold ? cursor.value.holdKey + 1 : cursor.value.holdKey };
  },
  shot(chapter: string, shot: string) {
    active.value = { chapter, shot };
    // 录片脚本按这条对齐片头（屏幕录像的时间戳也是墙钟）。
    if (props.record) console.info(`[film:shot] ${chapter}/${shot} ${Date.now()}`);
  },
  veil(on: boolean, ms: number) { animateTo(veilEl.value, { opacity: on ? '1' : '0' }, ms); },
  dissolve(on: boolean, ms: number) {
    if (on) animateTo(propEl.value, { opacity: '0', transform: 'scale(.955)' }, ms);
    else animateTo(propEl.value, { opacity: '1', transform: 'scale(1)' }, ms, { opacity: '0', transform: 'scale(1.035)' });
  },
  watch(state: WatchState, fly?: { from: { x: number; y: number }; ms: number }) {
    if (!fly || state !== 'lit') { watchState.value = state; return; }
    const from = toStage(fly.from), el = flyerEl.value;
    if (!el || (!props.record && show.reduced.value)) { watchState.value = 'lit'; return; }
    // 一张训练卡从窗口里那一天飞到表盘上，边飞边缩小；落定那一刻表盘亮起。
    el.getAnimations().forEach((animation) => animation.cancel());
    const lift = Math.min(160, Math.hypot(FACE.x - from.x, FACE.y - from.y) * 0.18);
    const at = (x: number, y: number, s: number) => `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${s})`;
    const flight = el.animate([
      { transform: at(from.x, from.y, 1), opacity: 0 },
      { transform: at(from.x, from.y, 1.06), opacity: 1, offset: 0.12 },
      { transform: at((from.x + FACE.x) / 2, Math.min(from.y, FACE.y) - lift, 0.86), opacity: 1, offset: 0.55 },
      { transform: at(FACE.x, FACE.y, 0.42), opacity: 0 },
    ], { duration: fly.ms, easing: 'cubic-bezier(.45,0,.2,1)', fill: 'forwards' });
    flight.finished.then(() => { watchState.value = 'lit'; }, () => {});
  },
};

const timings: ShotTiming[] = [];
/* 录片 / 调试：?from=<章>:<镜> 从那一镜开始放（只在录片模式认）。 */
const fromParam = props.record ? new URLSearchParams(location.search).get('from')?.split(':') ?? null : null;
const startChapter = fromParam ? Math.max(0, FILM.findIndex((chapter) => chapter.id === fromParam[0])) : 0;
const startShot = fromParam?.[1] ?? null;
const stop = () => { generation++; controller?.abort(); clock?.dispose(); };
const run = async (from = 0, fromShot: string | null = from === startChapter ? startShot : null) => {
  stop();
  if (!ready.value || !frame.value?.contentWindow) return;
  const token = generation;
  controller = new AbortController();
  clock = new PlaybackClock(controller.signal);
  clock.setPaused(!show.running.value);
  finished.value = false; timings.length = 0;
  watchState.value = 'hidden';
  const director = new Director(frame.value.contentWindow, clock, stage, lang.value);
  try {
    director.api.pause(false);
    director.rate();
    const note = (timing: ShotTiming) => {
      timings.push(timing);
      if (timing.actual > timing.planned) console.info(`[film] ${timing.chapter}/${timing.shot} ran ${timing.actual}ms > ${timing.planned}ms`);
    };
    let skipTo = fromShot;
    for (const chapter of FILM.slice(from)) {
      for (const shot of chapter.shots) {
        if (skipTo && shot.id !== skipTo) continue;
        skipTo = null;
        try {
          await playShot(chapter.id, shot, director, note);
        } catch (error) {
          // 一镜失败不拖垮整片：记下来、揭开遮挡、复位镜头，接着放下一镜（录片脚本会看到这条日志）。
          if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error;
          console.error(`[film] ${chapter.id}/${shot.id} failed:`, error);
          stage.veil(false, 0); stage.dissolve(false, 0); stage.camera({ x: 0, y: 0, zoom: 1 }, 0); director.hidePointer();
        }
      }
    }
    if (token !== generation) return;
    finished.value = true;
    (window as Window & { __ZB_FILM_DONE__?: ShotTiming[] }).__ZB_FILM_DONE__ = [...timings];
    emit('done');
  } catch (error) {
    if (token !== generation || controller.signal.aborted) return;
    failed.value = true;
    root.value?.setAttribute('data-error', error instanceof Error ? error.message : String(error));
    console.error('[film]', error);
  }
};
const toggle = () => { if (finished.value || failed.value) { failed.value = false; show.play(); void run(0, null); } else show.toggle(); };

/** 载入（或换语言后重新载入）演示 iframe：界面语言跟字幕走。 */
const load = () => {
  stop();
  ready.value = false; finished.value = false;
  stage.pose('title', 0); stage.dissolve(false, 0); stage.camera({ x: 0, y: 0, zoom: 1 }, 0);
  // 片头的标语留给第一镜去上：等 iframe 就绪再逐字入焦，录像里才拍得到。
  caption.value = null; watchState.value = 'hidden';
  src.value = '/?' + new URLSearchParams({ demo: '1', showcase: '1', film: '1', route: '/', theme: 'dark', lang: lang.value }).toString();
};
const message = (event: MessageEvent) => {
  if (event.origin !== location.origin || event.source !== frame.value?.contentWindow) return;
  if (event.data?.source !== 'zeppbridge-demo' || event.data.type !== 'ready') return;
  // iframe 中途重载（开发服务器整页刷新、浏览器回收内存）会再报一次就绪：从正在放的这一镜接着放，不从头来。
  const resume = ready.value && !finished.value ? FILM.findIndex((chapter) => chapter.id === active.value.chapter) : -1;
  ready.value = true;
  if (resume >= 0) void run(resume, active.value.shot || null);
  else void run(startChapter);
};
watch(show.running, (running) => {
  clock?.setPaused(!running);
  frame.value?.contentWindow?.__ZB_PRESENTATION__?.pause(!running);
});
// 落地页的语言在挂载之后才定下来（LandingPage 的 onMounted 晚于这里）：以前 iframe 停在第一次的语言，英文访客看到中文界面。
watch(lang, load);

onMounted(() => {
  window.addEventListener('message', message);
  resize = new ResizeObserver(([entry]) => {
    const box = entry?.contentRect;
    if (box) scale.value = Math.min(box.width / 1920, box.height / 1080);
  });
  if (root.value) resize.observe(root.value);
  load();
});
onBeforeUnmount(() => { stop(); resize?.disconnect(); window.removeEventListener('message', message); });
</script>

<template>
  <section ref="root" class="film" :class="{ recording: record }" :data-chapter="active.chapter" :data-shot="active.shot" :data-pose="pose" :data-lang="lang" aria-roledescription="film">
    <div class="film-aurora" aria-hidden="true"><i class="a1"></i><i class="a2"></i><i class="a3"></i></div>
    <div ref="stageEl" class="film-stage" :style="{ transform: `translate(-50%, -50%) scale(${scale})` }">
      <div ref="propEl" class="film-prop">
        <div ref="windowEl" class="film-window">
          <div ref="cameraEl" class="film-camera" :style="{ '--zoom': zoom }">
            <iframe v-if="src" :key="src" ref="frame" :src="src" title="ZeppBridge" :class="{ shown: ready }" tabindex="-1" inert />
            <i v-if="cursor.visible" class="film-pointer" :class="{ pressed: cursor.pressed }" :style="{ transform: `translate(${cursor.x}px, ${cursor.y}px) scale(calc(1 / var(--zoom)))` }" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="26" height="26"><path d="M5 3.2v15.6l4.3-4.1 2.7 6.1 2.6-1.1-2.7-6h5.9z" /></svg>
              <b v-if="cursor.hold" :key="cursor.holdKey" class="film-hold" :style="{ animationDuration: `${cursor.hold}ms` }"></b>
            </i>
          </div>
        </div>
      </div>
      <div class="film-watch" :class="watchState" aria-hidden="true">
        <img :src="watchImage" alt="" width="381" height="515" />
        <div class="film-face"><small>{{ script.watchMeta }}</small><strong>{{ script.watchName }}</strong><em>▶</em></div>
      </div>
      <div ref="flyerEl" class="film-flyer" aria-hidden="true"><strong>{{ script.watchName }}</strong><small>{{ script.watchMeta }}</small></div>
      <Transition name="film-caption" mode="out-in">
        <div v-if="text" :key="caption ?? ''" class="film-caption" :class="[`at-${pose}`, { url: caption === 'tryIt' }]" aria-live="polite">
          <h2 :aria-label="text.title"><span v-for="(glyph, index) in glyphs" :key="index" class="k" :style="{ '--i': index }" aria-hidden="true">{{ glyph }}</span></h2>
          <p v-if="text.sub">{{ text.sub }}</p>
        </div>
      </Transition>
      <div ref="veilEl" class="film-veil" aria-hidden="true"></div>
    </div>
    <div v-if="!record" class="film-buttons">
      <button type="button" class="film-toggle" :aria-label="finished || failed ? 'Replay' : show.running.value ? 'Pause' : 'Play'" @click="toggle">{{ finished || failed ? '↺' : show.running.value ? '❚❚' : '▶' }}</button>
      <button type="button" class="film-skip" aria-label="Skip" @click="emit('skip')">↓</button>
    </div>
  </section>
</template>

<style scoped src="./film.css"></style>
