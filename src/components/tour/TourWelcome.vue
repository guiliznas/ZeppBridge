<script setup lang="ts">
/*
 * 引导沙盒的第一屏：大字问候轮播（各语言一句，只交叉淡入淡出），下面是玻璃语言轮，
 * 已按系统语言选好（首次启动时 i18n 就是用 pickLocale 定的语言）。拨语言走和顶栏一样的
 * 灰烬换语言（lib/motion/ashSwitch.ts）。「开始看看」进第一章，「跳过」直接回到应用。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import CapsuleWheel from '../CapsuleWheel.vue';
import { locale, LOCALE_LABELS, LOCALES, type Locale } from '../../i18n';
import { useTourText } from './tour.i18n';

const emit = defineEmits<{ (event: 'start'): void; (event: 'skip'): void }>();
const t = useTourText();

/* 问候本身不翻译：每种语言说它自己的那一句。 */
const GREETINGS = ['你好', 'Hello', 'Hola', 'Bonjour', 'Hallo', 'Olá', 'Hoi', 'Привет', 'नमस्ते'];
const greeting = ref(0);
let timer = 0;

const wheel = ref<{ $el: HTMLElement } | null>(null);
const items = computed(() => LOCALES.map((code) => ({ value: code, label: LOCALE_LABELS[code] })));
const onLocale = (value: string | number) => {
  const rect = wheel.value?.$el.getBoundingClientRect();
  const origin = rect?.width ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : undefined;
  void import('../../lib/motion/ashSwitch').then(({ switchLocaleWithAsh }) => switchLocaleWithAsh(String(value) as Locale, origin));
};

const startButton = ref<HTMLElement | null>(null);
const onKey = (event: KeyboardEvent) => {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  event.stopImmediatePropagation();
  emit('skip');
};

onMounted(() => {
  if (!(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)) {
    timer = window.setInterval(() => { greeting.value = (greeting.value + 1) % GREETINGS.length; }, 2200);
  }
  window.addEventListener('keydown', onKey, true);
  startButton.value?.focus({ preventScroll: true });
});
onBeforeUnmount(() => {
  window.clearInterval(timer);
  window.removeEventListener('keydown', onKey, true);
});
</script>

<template>
  <div class="welcome" role="dialog" aria-modal="true" aria-labelledby="welcome-greeting">
    <div class="welcome-greeting" aria-live="off">
      <Transition name="greet">
        <h1 id="welcome-greeting" :key="greeting" :lang="greeting === 0 ? 'zh' : undefined">{{ GREETINGS[greeting] }}</h1>
      </Transition>
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
.welcome-greeting { position: relative; display: grid; height: clamp(84px, 14vw, 140px); width: min(640px, 90vw); place-items: center; }
.welcome-greeting h1 {
  grid-area: 1 / 1;
  margin: 0;
  color: var(--ink);
  font-size: clamp(56px, 10vw, 112px);
  font-weight: 800;
  letter-spacing: -.03em;
  line-height: 1;
}
.welcome-pick { margin: 6px 0 0; color: var(--muted); font-size: var(--fs-sm); }
.welcome-wheel { width: min(320px, 86vw); }
.welcome-actions { display: grid; justify-items: center; gap: 10px; margin-top: 10px; }
.welcome-start { min-width: 200px; min-height: 44px; font-size: var(--fs-md); }
.welcome-skip { padding: 6px 10px; border: 0; background: none; color: var(--muted); font: inherit; font-size: var(--fs-sm); cursor: pointer; }
.welcome-skip:hover { color: var(--ink); }
.welcome-skip:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; border-radius: 6px; }
.greet-enter-active { transition: opacity 700ms ease, transform 700ms cubic-bezier(.2, .8, .2, 1); }
.greet-leave-active { transition: opacity 500ms ease, transform 500ms ease; }
.greet-enter-from { opacity: 0; transform: translateY(14px); }
.greet-leave-to { opacity: 0; transform: translateY(-10px); }
@media (prefers-reduced-motion: reduce) { .greet-enter-active, .greet-leave-active { transition: none; } }
</style>
