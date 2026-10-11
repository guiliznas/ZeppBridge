import type { LandingLocale } from '../../composables/useLandingLocale';

/** Playback controls for MotionReel. Chinese for zh; every other locale uses English, as before. */
export interface ReelCopy { preparing: string; failed: string; retry: string; replay: string; pause: string; play: string }

const REEL: Record<'zh' | 'en', ReelCopy> = {
  zh: { preparing: '正在准备演示', failed: '演示暂时未能继续', retry: '重试', replay: '重播', pause: '暂停', play: '播放' },
  en: { preparing: 'Preparing demo', failed: 'The demo could not continue', retry: 'Retry', replay: 'Replay', pause: 'Pause', play: 'Play' },
};

export const reelCopy = (locale: LandingLocale): ReelCopy => REEL[locale === 'zh' ? 'zh' : 'en'];
