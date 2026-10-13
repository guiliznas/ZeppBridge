/**
 * 交出去以后那一句提示（回执卡、运动页「问 AI」浮层共用，同一句话只有这一份渲染）：
 * 全自动的进度 > 文件已在剪贴板（Ctrl+V）> 拖文件（放不进剪贴板的系统）。
 */
import { computed } from 'vue';
import { autoStage, clip } from '../../../composables/ai/useAutoHandoff';
import { useStageText } from './stage.i18n';

export const useHandoffLead = (provider: () => string) => {
  const s = useStageText();
  return computed(() => {
    const p = provider();
    switch (autoStage.value) {
      case 'waiting': return s.value.autoWaiting(p);
      case 'file': return s.value.autoFilling;
      case 'filled': return s.value.autoFilled;
      case 'sent': return s.value.autoSent(p);
      case 'aborted': case 'timeout': return s.value.autoStopped;
      default: return clip.value === 'file' ? s.value.receiptPaste(p) : s.value.receiptLead;
    }
  });
};
