<script setup lang="ts">
/*
 * 新手引导挂在外壳上的那一层：聚光框与说明卡、沙盒第一屏、老用户的「V3 变了什么」邀请，
 * 以及首次启动时决定走哪条路。AppShell 在后端就绪后异步挂它。
 *
 * 首次启动（只判断一次，记在真实 localStorage）：
 *   - 新装（没连过账号、也没同步过）→ 直接进示例沙盒，从语言轮开始走完整引导，看完回到「账号与设备」卡去连接；
 *   - 有数据的库（多半是从 2.x 或早期 beta 升上来的）→ 底部浮一张小卡问要不要看「V3 变了什么」，不强行打断。
 */
import { onMounted, ref } from 'vue';
import TourOverlay from './TourOverlay.vue';
import TourWelcome from './TourWelcome.vue';
import { launchSandbox, startTour, useTour } from '../../composables/useTour';
import { useSyncController } from '../../composables/useSyncController';
import { FULL_TOUR } from '../../lib/tour/chapters';
import { firstLaunchHandled, leaveSandbox, markFirstLaunchHandled, markSeen, sandboxFlags } from '../../lib/tour/sandbox';
import { INLINE_CHAPTERS } from '../../lib/tour/chapters';
import { isDesktop } from '../../lib/bridge';
import { useTourText } from './tour.i18n';

const t = useTourText();
const { welcomeOpen } = useTour();
const { appStatus, refreshStatus } = useSyncController();
const invite = ref(false);
const flags = sandboxFlags();

const startFromWelcome = () => {
  welcomeOpen.value = false;
  if (flags) startTour(flags.chapters, 'sandbox');
};
const skipFromWelcome = () => {
  welcomeOpen.value = false;
  markSeen([...FULL_TOUR, ...INLINE_CHAPTERS, 'whatsnew']);
  leaveSandbox(flags?.ret ?? '/');
};

const acceptInvite = () => {
  invite.value = false;
  launchSandbox(['whatsnew']);
};
const declineInvite = () => { invite.value = false; };

const decideFirstLaunch = async () => {
  if (!isDesktop() || window.__ZB_DEMO__?.demo || firstLaunchHandled()) return;
  if (!appStatus.value) await refreshStatus().catch(() => undefined);
  const status = appStatus.value;
  if (!status) return;
  markFirstLaunchHandled();
  const fresh = !status.configured && !status.last_sync && !status.streams.some((stream) => (stream.records ?? 0) > 0);
  if (fresh) launchSandbox([...FULL_TOUR], { welcome: true, ret: '/settings/account' });
  else invite.value = true;
};

onMounted(() => {
  if (flags) {
    if (flags.welcome) welcomeOpen.value = true;
    else startTour(flags.chapters, 'sandbox');
    return;
  }
  void decideFirstLaunch();
});
</script>

<template>
  <TourOverlay />
  <TourWelcome v-if="welcomeOpen" @start="startFromWelcome" @skip="skipFromWelcome" />
  <Transition name="tour-invite">
    <div v-if="invite" class="tour-invite" role="dialog" aria-labelledby="tour-invite-text">
      <span id="tour-invite-text">{{ t.inviteText }}</span>
      <button type="button" class="button primary" @click="acceptInvite">{{ t.inviteGo }}</button>
      <button type="button" class="tour-invite-later" @click="declineInvite">{{ t.inviteLater }}</button>
    </div>
  </Transition>
</template>

<style scoped>
.tour-invite {
  position: fixed; left: 50%; bottom: 24px; z-index: 8000;
  display: flex; align-items: center; gap: 10px;
  max-width: calc(100vw - 32px);
  padding: 8px 8px 8px 16px;
  border: 1px solid var(--mat-glass-line); border-radius: 999px;
  background: var(--mat-glass-strong); box-shadow: var(--mat-glass-shadow);
  backdrop-filter: blur(18px) saturate(1.2);
  color: var(--ink); font-size: var(--fs-sm);
  transform: translateX(-50%);
}
.tour-invite .button { min-height: 32px; padding: 0 14px; }
.tour-invite-later { padding: 6px 10px; border: 0; background: none; color: var(--muted); font: inherit; cursor: pointer; }
.tour-invite-later:hover { color: var(--ink); }
.tour-invite-later:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; border-radius: 6px; }
.tour-invite-enter-active { transition: opacity 360ms ease 600ms, transform 420ms cubic-bezier(.2, .8, .2, 1) 600ms; }
.tour-invite-leave-active { transition: opacity 200ms ease, transform 220ms ease; }
.tour-invite-enter-from, .tour-invite-leave-to { opacity: 0; transform: translate(-50%, 14px); }
@media (max-width: 760px) { .tour-invite { bottom: 86px; border-radius: 18px; flex-wrap: wrap; } }
@media (prefers-reduced-motion: reduce) { .tour-invite-enter-active, .tour-invite-leave-active { transition: none; } }
</style>
