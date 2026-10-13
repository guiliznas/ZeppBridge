<script setup lang="ts">
/*
 * 新手引导的聚光框 + 玻璃说明卡（状态在 composables/useTour.ts）。
 *
 * 聚光框是一块圆角框，外面一圈超大的阴影把别处压暗；换步时只动 transform（FLIP：先摆到新位置，
 * 再从旧位置的样子放回来），说明卡也只过渡 transform。引导期间整页不接点击，免得点到别处把
 * 步骤带跑；Esc 跳过（经 onMotionEscape 排在最前），← → 翻步。prefers-reduced-motion 下一律直接落位。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useTour, type TargetBox } from '../../composables/useTour';
import { inSandbox } from '../../lib/tour/sandbox';
import { useTourText } from './tour.i18n';
import { onMotionEscape } from '../../lib/motion/interrupt';

const t = useTourText();
const { active, box, current, next, prev, skip } = useTour();
const sandbox = inSandbox();

const hole = ref<HTMLElement | null>(null);
const card = ref<HTMLElement | null>(null);
const cardSize = ref({ width: 360, height: 160 });
const viewport = ref({ width: window.innerWidth, height: window.innerHeight });
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

type StepCopy = Record<string, string>;
const text = computed(() => {
  const now = current.value;
  if (!now) return '';
  return (t.value.steps[now.chapter] as StepCopy)[`s${now.step + 1}`] ?? '';
});
const title = computed(() => (current.value ? t.value.chapter[current.value.chapter] : ''));
/** 只有一步的就地提示：只给一个「知道了」。 */
const single = computed(() => current.value?.mode === 'inline' && current.value.total === 1);

const GAP = 14;
const EDGE = 16;
const cardPosition = computed(() => {
  const { width: vw, height: vh } = viewport.value;
  const { width, height } = cardSize.value;
  const target = box.value;
  if (!target) return { x: (vw - width) / 2, y: (vh - height) / 2 };
  const x = Math.min(Math.max(target.x + target.width / 2 - width / 2, EDGE), vw - width - EDGE);
  const below = target.y + target.height + GAP;
  const above = target.y - GAP - height;
  if (below + height <= vh - EDGE) return { x, y: below };
  if (above >= EDGE) return { x, y: above };
  // 上下都放不下（目标几乎占满一屏）：贴在目标里面靠下。
  return { x, y: Math.max(EDGE, Math.min(target.y + target.height - height - GAP, vh - height - EDGE)) };
});

let shown: TargetBox | null = null;
watch(box, async (target) => {
  await nextTick();
  const el = hole.value;
  if (!target || !el) { shown = null; return; }
  if (!reduced()) {
    if (shown) {
      const sx = target.width ? shown.width / target.width : 1;
      const sy = target.height ? shown.height / target.height : 1;
      el.animate([
        { transform: `translate(${shown.x}px, ${shown.y}px) scale(${sx}, ${sy})` },
        { transform: `translate(${target.x}px, ${target.y}px) scale(1, 1)` },
      ], { duration: 420, easing: 'cubic-bezier(.2, .8, .2, 1)' });
    } else {
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' });
    }
  }
  shown = { ...target };
});

/* 每换一步把焦点放回说明卡上的主按钮：键盘用户不用找。 */
watch(() => current.value?.index, async () => {
  await nextTick();
  card.value?.querySelector<HTMLElement>('[data-primary]')?.focus({ preventScroll: true });
}, { immediate: true });

const onKey = (event: KeyboardEvent) => {
  if (!active.value) return;
  // Esc 不在这里：全局的动效打断、弹层都在更早的 window 捕获监听上，走 onMotionEscape 的 first 才排得到最前。
  if (event.key === 'ArrowRight') {
    event.preventDefault();
    next();
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault();
    prev();
  } else if (event.key === 'Tab') {
    const buttons = [...(card.value?.querySelectorAll<HTMLElement>('button') ?? [])];
    if (!buttons.length) return;
    const index = buttons.indexOf(document.activeElement as HTMLElement);
    event.preventDefault();
    const step = event.shiftKey ? -1 : 1;
    buttons[(index + step + buttons.length) % buttons.length]?.focus();
  }
};
const onResize = () => { viewport.value = { width: window.innerWidth, height: window.innerHeight }; };

let observer: ResizeObserver | null = null;
watch(card, (el) => {
  observer?.disconnect();
  if (!el) return;
  observer = new ResizeObserver(([entry]) => {
    const rect = entry.target.getBoundingClientRect();
    cardSize.value = { width: rect.width, height: rect.height };
  });
  observer.observe(el);
});

let releaseEscape: (() => void) | null = null;
onMounted(() => {
  releaseEscape = onMotionEscape(() => {
    if (!active.value) return false;
    skip();
    return true;
  }, { first: true });
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onResize);
});
onBeforeUnmount(() => {
  releaseEscape?.();
  window.removeEventListener('keydown', onKey, true);
  window.removeEventListener('resize', onResize);
  observer?.disconnect();
});
</script>

<template>
  <div v-if="sandbox" class="tour-sample" :title="t.sampleHint" role="note">{{ t.sample }}</div>
  <div v-if="active && current" class="tour-layer" :class="{ 'is-dim': !box }">
    <div
      v-if="box"
      ref="hole"
      class="tour-hole"
      aria-hidden="true"
      :style="{ width: `${box.width}px`, height: `${box.height}px`, transform: `translate(${box.x}px, ${box.y}px)` }"
    ></div>
    <section
      ref="card"
      class="tour-card"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-card-title"
      aria-describedby="tour-card-text"
      :style="{ transform: `translate(${cardPosition.x}px, ${cardPosition.y}px)` }"
    >
      <header class="tour-head">
        <p id="tour-card-title" class="tour-title">{{ title }}</p>
        <span v-if="!single" class="tour-progress">{{ t.progress(current.index + 1, current.total) }}</span>
      </header>
      <p id="tour-card-text" class="tour-text">{{ text }}</p>
      <footer class="tour-actions">
        <template v-if="single">
          <button type="button" class="button primary" data-primary @click="next">{{ t.gotIt }}</button>
        </template>
        <template v-else>
          <button type="button" class="tour-skip" @click="skip">{{ t.skip }}</button>
          <span class="tour-spacer"></span>
          <button v-if="!current.first" type="button" class="button secondary" @click="prev">{{ t.prev }}</button>
          <button type="button" class="button primary" data-primary @click="next">{{ current.last ? t.done : t.next }}</button>
        </template>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.tour-layer { position: fixed; inset: 0; z-index: 9000; pointer-events: auto; }
.tour-layer.is-dim { background: rgb(0 0 0 / .46); }
.tour-hole {
  position: fixed; top: 0; left: 0;
  border-radius: 16px;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 70%, transparent), 0 0 0 200vmax rgb(0 0 0 / .46);
  transform-origin: 0 0;
  pointer-events: none;
}
.tour-card {
  position: fixed; top: 0; left: 0;
  width: min(360px, calc(100vw - 32px));
  padding: 16px 18px 14px;
  border: 1px solid var(--mat-glass-line);
  border-radius: var(--radius-md);
  background: var(--mat-glass-strong);
  box-shadow: var(--mat-glass-shadow);
  backdrop-filter: blur(18px) saturate(1.2);
  color: var(--ink);
  transition: transform 380ms cubic-bezier(.2, .8, .2, 1);
}
.tour-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 6px; }
.tour-title { margin: 0; color: var(--accent); font-size: var(--fs-xs); font-weight: 700; letter-spacing: .04em; }
.tour-progress { margin-left: auto; color: var(--subtle); font-family: var(--font-mono); font-size: var(--fs-2xs); }
.tour-text { margin: 0 0 14px; font-size: var(--fs-md); line-height: 1.55; }
.tour-actions { display: flex; align-items: center; gap: 8px; }
.tour-spacer { flex: 1; }
.tour-skip { padding: 6px 4px; border: 0; background: none; color: var(--muted); font: inherit; font-size: var(--fs-sm); cursor: pointer; }
.tour-skip:hover { color: var(--ink); }
.tour-skip:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; border-radius: 6px; }
.tour-sample {
  /* 压在引导层下面：说明卡贴到左下角时字不会被它挡住（引导期间它被压暗，但仍看得见）。 */
  position: fixed; left: 16px; bottom: 16px; z-index: 8999;
  padding: 5px 12px; border: 1px solid var(--mat-glass-line); border-radius: 999px;
  background: var(--mat-glass-strong); box-shadow: var(--mat-glass-shadow);
  color: var(--accent); font-size: var(--fs-xs); font-weight: 700; letter-spacing: .06em;
  pointer-events: none;
}
@media (max-width: 760px) { .tour-sample { bottom: 86px; } }
@media (prefers-reduced-motion: reduce) { .tour-card { transition: none; } }
</style>
