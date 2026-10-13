<script setup lang="ts">
/*
 * 引导沙盒的第一屏：一句问候**一笔一笔写出来**（10-13，像苹果开机那句 hello），写完停一会、淡去，
 * 再写下一种语言的；下面是玻璃语言轮，已按系统语言选好（首次启动时 i18n 就是用 pickLocale 定的语言）。
 * 拨语言走和顶栏一样的灰烬换语言（lib/motion/ashSwitch.ts），问候也立刻换成那种语言、重新写一遍。
 * 「开始看看」进第一章，「跳过」直接回到应用。
 *
 * 写字：SVG 文字的描边按虚线从无到有画出来（stroke-dashoffset），一条笔尖从左往右扫过去（clip-path
 * inset），描边画到七成时字的填色再慢慢浮上来。两段交替（先淡出再写下一句），不叠影——以前两句问候
 * 交叉淡化，Bonjour 和 Hola 叠成「BoHolar」。字体用系统自带的手写体（Windows 的 Segoe Script / Ink Free、
 * 中文楷体；macOS 的 Snell Roundhand / 楷体），没有就退到 cursive。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import CapsuleWheel from '../CapsuleWheel.vue';
import { locale, LOCALE_LABELS, LOCALES, type Locale } from '../../i18n';
import { useTourText } from './tour.i18n';
import { onMotionEscape } from '../../lib/motion/interrupt';

const emit = defineEmits<{ (event: 'start'): void; (event: 'skip'): void }>();
const t = useTourText();

/* 问候本身不翻译：每种语言说它自己的那一句。 */
const GREETINGS = ['你好', 'Hello', 'Hola', 'Bonjour', 'Hallo', 'Olá', 'Hoi', 'Привет', 'नमस्ते'];
const GREETING_OF: Record<Locale, number> = { zh: 0, en: 1, es: 2, fr: 3, de: 4, 'pt-BR': 5, 'pt-PT': 5, nl: 6, ru: 7, 'hi-IN': 8 };
const LANG_OF = ['zh', 'en', 'es', 'fr', 'de', 'pt', 'nl', 'ru', 'hi'];

const greeting = ref(GREETING_OF[locale.value] ?? 1);
const word = computed(() => GREETINGS[greeting.value] ?? '');
const svg = ref<SVGSVGElement | null>(null);
const textEl = ref<SVGTextElement | null>(null);
const box = ref({ x: 0, y: 0, width: 600, height: 160 });

const WRITE_MS = 1900;
const HOLD_MS = 1500;
const FADE_MS = 420;
let timer = 0;
let running: Animation[] = [];
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const wait = (ms: number) => new Promise<void>((resolve) => { timer = window.setTimeout(resolve, ms); });
let cycle = 0;

const fit = () => {
  const el = textEl.value;
  if (!el) return;
  try {
    const b = el.getBBox();
    if (b.width) box.value = { x: b.x - 24, y: b.y - 12, width: b.width + 48, height: b.height + 24 };
  } catch {
    // 还没布局好：沿用上一次的框。
  }
};

const stopAll = () => {
  for (const a of running) a.cancel();
  running = [];
};

/** 写一句：笔尖从左扫到右，描边一路画出来，最后填色浮上来。 */
const write = async () => {
  await nextTick();
  fit();
  const el = textEl.value;
  const host = svg.value;
  if (!el || !host) return;
  stopAll();
  if (reduced()) {
    running = [host.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, fill: 'forwards' })];
    return;
  }
  const ease = 'cubic-bezier(.45, .05, .35, 1)';
  running = [
    host.animate([{ opacity: 1 }, { opacity: 1 }], { duration: 1, fill: 'forwards' }),
    el.animate([{ clipPath: 'inset(-20% 100% -20% -2%)' }, { clipPath: 'inset(-20% -2% -20% -2%)' }], { duration: WRITE_MS * 0.92, easing: ease, fill: 'forwards' }),
    el.animate([{ strokeDashoffset: 1600 }, { strokeDashoffset: 0 }], { duration: WRITE_MS, easing: ease, fill: 'forwards' }),
    el.animate([{ fillOpacity: 0 }, { fillOpacity: 0, offset: 0.55 }, { fillOpacity: 1 }], { duration: WRITE_MS + 380, easing: 'ease-out', fill: 'forwards' }),
  ];
};

const fadeOut = async () => {
  const host = svg.value;
  if (!host || reduced()) return;
  const a = host.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-6px)' }], { duration: FADE_MS, easing: 'cubic-bezier(.4, 0, 1, 1)', fill: 'forwards' });
  running.push(a);
  await a.finished.catch(() => undefined);
};

/** 轮播：写 → 停 → 淡出 → 下一句。`to` 给了就直接写那一句（拨了语言）。 */
const loop = async (to?: number) => {
  const mine = ++cycle;
  window.clearTimeout(timer);
  if (to !== undefined && to !== greeting.value) {
    await fadeOut();
    if (mine !== cycle) return;
    greeting.value = to;
  }
  for (;;) {
    await write();
    if (mine !== cycle || reduced()) return;
    await wait(WRITE_MS + HOLD_MS);
    if (mine !== cycle) return;
    await fadeOut();
    if (mine !== cycle) return;
    greeting.value = (greeting.value + 1) % GREETINGS.length;
  }
};

/* 拨了语言：问候换成那种语言，重新写一遍。 */
watch(locale, (value) => {
  const index = GREETING_OF[value];
  if (index !== undefined) void loop(index);
});

const wheel = ref<{ $el: HTMLElement } | null>(null);
const items = computed(() => LOCALES.map((code) => ({ value: code, label: LOCALE_LABELS[code] })));
const onLocale = (value: string | number) => {
  const rect = wheel.value?.$el.getBoundingClientRect();
  const origin = rect?.width ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : undefined;
  void import('../../lib/motion/ashSwitch').then(({ switchLocaleWithAsh }) => switchLocaleWithAsh(String(value) as Locale, origin));
};

const startButton = ref<HTMLElement | null>(null);
let releaseEscape: (() => void) | null = null;

onMounted(() => {
  releaseEscape = onMotionEscape(() => { emit('skip'); return true; }, { first: true });
  startButton.value?.focus({ preventScroll: true });
  // 手写体是系统字体，第一次量字宽前等它就绪（拿不到也不等太久）。
  const ready = document.fonts?.load ? document.fonts.load('80px "Segoe Script"').catch(() => undefined) : Promise.resolve();
  void Promise.race([ready, new Promise((resolve) => window.setTimeout(resolve, 400))]).then(() => loop());
});
onBeforeUnmount(() => {
  cycle += 1;
  window.clearTimeout(timer);
  stopAll();
  releaseEscape?.();
});
</script>

<template>
  <div class="welcome" role="dialog" aria-modal="true" aria-labelledby="welcome-greeting">
    <div class="welcome-greeting" aria-live="off">
      <svg ref="svg" class="hand" :viewBox="`${box.x} ${box.y} ${box.width} ${box.height}`" preserveAspectRatio="xMidYMid meet" role="img" :aria-label="word">
        <text id="welcome-greeting" ref="textEl" :lang="LANG_OF[greeting]" x="0" y="0" text-anchor="middle" dominant-baseline="central"
          :class="['hand-text', { cjk: greeting === 0, wide: greeting >= 7 }]">{{ word }}</text>
      </svg>
    </div>
    <p class="welcome-pick">{{ t.welcomePick }}</p>
    <CapsuleWheel ref="wheel" class="welcome-wheel" loop :span="260" :items="items" :model-value="locale" :aria-label="t.welcomePick" @update:model-value="onLocale" />
    <div class="welcome-actions">
      <button ref="startButton" type="button" class="button primary welcome-start" @click="emit('start')">{{ t.welcomeStart }}</button>
      <button type="button" class="welcome-skip" @click="emit('skip')">{{ t.welcomeSkip }}</button>
    </div>
  </div>
</template>

<style scoped>
.welcome {
  position: fixed; inset: 0; z-index: 9002;
  display: grid; place-content: center; justify-items: center; gap: 18px;
  padding: 24px;
  background: color-mix(in srgb, var(--bg) 72%, transparent);
  backdrop-filter: blur(28px) saturate(1.15);
  text-align: center;
}
.welcome-greeting { position: relative; display: grid; height: clamp(96px, 16vw, 168px); width: min(680px, 90vw); place-items: center; }
.hand { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; opacity: 0; }
.hand-text {
  font-family: 'Segoe Script', 'Snell Roundhand', 'Ink Free', 'Bradley Hand', 'Segoe Print', 'KaiTi', 'STKaiti', 'Kaiti SC', cursive;
  font-size: 120px;
  font-weight: 700;
  fill: var(--ink);
  fill-opacity: 0;
  stroke: var(--ink);
  stroke-width: 1.6px;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 1600;
  stroke-dashoffset: 1600;
  paint-order: stroke;
}
/* 中文用楷体（手写体里没有汉字），笔画粗一点更像写的。 */
.hand-text.cjk { font-family: 'KaiTi', 'STKaiti', 'Kaiti SC', 'Segoe Script', cursive; font-weight: 400; stroke-width: 2px; }
.hand-text.wide { font-size: 104px; }
.welcome-pick { margin: 6px 0 0; color: var(--muted); font-size: var(--fs-sm); }
.welcome-wheel { width: min(320px, 86vw); }
.welcome-actions { display: grid; justify-items: center; gap: 10px; margin-top: 10px; }
.welcome-start { min-width: 200px; min-height: 44px; font-size: var(--fs-md); }
.welcome-skip { padding: 6px 10px; border: 0; background: none; color: var(--muted); font: inherit; font-size: var(--fs-sm); cursor: pointer; }
.welcome-skip:hover { color: var(--ink); }
.welcome-skip:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; border-radius: 6px; }
@media (prefers-reduced-motion: reduce) { .hand-text { stroke-dashoffset: 0; fill-opacity: 1; } }
</style>
