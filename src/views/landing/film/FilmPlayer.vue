<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { PlaybackClock } from '../playback';
import { useShowcase } from '../useShowcase';
import { Director, playChapter, type ShotTiming } from './director';
import { FILM } from './chapters';
import { filmCaption, type CaptionKey } from './copy';
import type { Camera, Pose } from './types';
import type { LandingLocale } from '../../../composables/useLandingLocale';

/**
 * 网站开场即宣传片（计划第三、四节）。真应用跑在 iframe 里（演示模式、合成数据），导演层照时间线操作它；
 * 外面这层只做舞台：窗口姿态、镜头、字幕、指针、黑场。录对外视频时用的是同一个组件（?film=record）。
 */
const props = defineProps<{ locale: LandingLocale; record?: boolean }>();
const emit = defineEmits<{ done: []; skip: [] }>();

const root = ref<HTMLElement | null>(null);
const frame = ref<HTMLIFrameElement | null>(null);
const windowEl = ref<HTMLElement | null>(null);
const cameraEl = ref<HTMLElement | null>(null);
const veilEl = ref<HTMLElement | null>(null);
const scale = ref(1);
const src = ref('');
const ready = ref(false), failed = ref(false), finished = ref(false);
const caption = ref<CaptionKey | null>('tagline');
const pose = ref<Pose>('title');
const zoom = ref(1);
const cursor = ref({ x: 640, y: 400, pressed: false, visible: false, hold: 0, holdKey: 0 });
const active = ref({ chapter: FILM[0]!.id, shot: '' });
const show = useShowcase(root);
const text = computed(() => (caption.value ? filmCaption(props.locale, caption.value) : null));
const chapterIndex = computed(() => FILM.findIndex((chapter) => chapter.id === active.value.chapter));

let controller: AbortController | undefined, clock: PlaybackClock | undefined, resize: ResizeObserver | undefined;
let generation = 0;
const EASE = 'cubic-bezier(.22,1,.36,1)';
/* 1920×1080 舞台上窗口（1280×800 的应用）的落点。 */
const POSES: Record<Pose, { x: number; y: number; s: number; o: number }> = {
  full: { x: 256, y: 44, s: 1.1, o: 1 },
  right: { x: 610, y: 150, s: 0.94, o: 1 },
  left: { x: 106, y: 150, s: 0.94, o: 1 },
  title: { x: 320, y: 200, s: 1, o: 0 },
};
const poseTransform = (p: Pose) => `translate(${POSES[p].x}px, ${POSES[p].y}px) scale(${POSES[p].s})`;
const animateTo = (el: HTMLElement | null, keyframe: Keyframe, ms: number) => {
  if (!el) return;
  if (ms <= 0 || (!props.record && show.reduced.value)) { Object.assign(el.style, keyframe); return; }
  const from: Keyframe = {};
  const style = getComputedStyle(el);
  for (const key of Object.keys(keyframe)) (from as Record<string, string>)[key] = style.getPropertyValue(key === 'transform' ? 'transform' : key);
  el.getAnimations().forEach((animation) => animation.cancel());
  Object.assign(el.style, keyframe);
  el.animate([from, keyframe], { duration: ms, easing: EASE });
};

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
  shot(chapter: string, shot: string) { active.value = { chapter, shot }; },
  veil(on: boolean, ms: number) { animateTo(veilEl.value, { opacity: on ? '1' : '0' }, ms); },
};

const timings: ShotTiming[] = [];
const stop = () => { generation++; controller?.abort(); clock?.dispose(); };
const run = async (from = 0) => {
  stop();
  if (!ready.value || !frame.value?.contentWindow) return;
  const token = generation;
  controller = new AbortController();
  clock = new PlaybackClock(controller.signal);
  clock.setPaused(!show.running.value);
  finished.value = false; timings.length = 0;
  const director = new Director(frame.value.contentWindow, clock, stage);
  try {
    director.api.pause(false);
    for (const chapter of FILM.slice(from)) {
      await playChapter(chapter, director, (timing) => {
        timings.push(timing);
        if (timing.actual > timing.planned) console.info(`[film] ${timing.chapter}/${timing.shot} ran ${timing.actual}ms > ${timing.planned}ms`);
      });
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
const jump = (index: number) => { show.play(); void run(index); };
const toggle = () => { if (finished.value || failed.value) { failed.value = false; jump(0); } else show.toggle(); };

const message = (event: MessageEvent) => {
  if (event.origin !== location.origin || event.source !== frame.value?.contentWindow) return;
  if (event.data?.source !== 'zeppbridge-demo' || event.data.type !== 'ready') return;
  ready.value = true;
  void run();
};
watch(show.running, (running) => {
  clock?.setPaused(!running);
  frame.value?.contentWindow?.__ZB_PRESENTATION__?.pause(!running);
});
watch(() => props.locale, () => { if (ready.value) jump(0); });

onMounted(() => {
  window.addEventListener('message', message);
  resize = new ResizeObserver(([entry]) => {
    const box = entry?.contentRect;
    if (box) scale.value = Math.min(box.width / 1920, box.height / 1080);
  });
  if (root.value) resize.observe(root.value);
  stage.pose('title', 0);
  src.value = '/?' + new URLSearchParams({ demo: '1', showcase: '1', film: '1', route: '/', theme: 'dark', lang: props.locale }).toString();
});
onBeforeUnmount(() => { stop(); resize?.disconnect(); window.removeEventListener('message', message); });
</script>

<template>
  <section ref="root" class="film" :class="{ recording: record }" :data-chapter="active.chapter" :data-shot="active.shot" :data-pose="pose" aria-roledescription="film">
    <div class="film-stage" :style="{ transform: `translate(-50%, -50%) scale(${scale})` }">
      <div ref="windowEl" class="film-window">
        <div ref="cameraEl" class="film-camera" :style="{ '--zoom': zoom }">
          <iframe v-if="src" ref="frame" :src="src" title="ZeppBridge" :class="{ shown: ready }" tabindex="-1" inert />
          <i v-if="cursor.visible" class="film-pointer" :class="{ pressed: cursor.pressed }" :style="{ transform: `translate(${cursor.x}px, ${cursor.y}px) scale(calc(1 / var(--zoom)))` }" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="26" height="26"><path d="M5 3.2v15.6l4.3-4.1 2.7 6.1 2.6-1.1-2.7-6h5.9z" /></svg>
            <b v-if="cursor.hold" :key="cursor.holdKey" class="film-hold" :style="{ animationDuration: `${cursor.hold}ms` }"></b>
          </i>
        </div>
      </div>
      <Transition name="film-caption" mode="out-in">
        <div v-if="text" :key="caption ?? ''" class="film-caption" :class="`at-${pose}`" aria-live="polite">
          <h2>{{ text.title }}</h2>
          <p v-if="text.sub">{{ text.sub }}</p>
        </div>
      </Transition>
      <div ref="veilEl" class="film-veil" aria-hidden="true"></div>
    </div>
    <div v-if="!record" class="film-controls">
      <ol class="film-chapters">
        <li v-for="(chapter, index) in FILM" :key="chapter.id" :class="{ on: index === chapterIndex, past: index < chapterIndex }">
          <button type="button" @click="jump(index)">{{ filmCaption(locale, chapter.label).title }}</button>
        </li>
      </ol>
      <div class="film-buttons">
        <button type="button" class="film-toggle" @click="toggle">{{ finished || failed ? '↺' : show.running.value ? '❚❚' : '▶' }}</button>
        <button type="button" class="film-skip" @click="emit('skip')">↓</button>
      </div>
    </div>
  </section>
</template>

<style scoped src="./film.css"></style>
