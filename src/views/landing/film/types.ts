import type { Director } from './director';
import type { CaptionKey } from './copy';

/**
 * 宣传片的时间线（网站开场与对外视频是同一份）：章 → 镜。
 * 每一镜有计划时长 `ms`：动作先做完，不够就停在最后一帧补足——整片长度固定，切点能对上音乐节拍。
 * 动作超时不截断（真应用慢了宁可晚切，不切在半个动画上），超出的量由时间线日志报出来调。
 */
export type FilmTheme = 'dark' | 'light';

/**
 * 应用窗口在 16:9 舞台上的姿态：
 * - `full`：窗口居中放大，字幕压在底部渐隐里；
 * - `left` / `right`：窗口偏到一侧让出字幕栏；
 * - `title`：窗口退场，只留大字（章节卡、标语，也用来遮住换页与重置）。
 */
export type Pose = 'full' | 'left' | 'right' | 'title';

export interface Shot {
  id: string;
  ms: number;
  pose?: Pose;
  caption?: CaptionKey | null;
  run(director: Director): Promise<void>;
}

export interface Chapter {
  id: string;
  /** 章节条上的名字（文案键）。 */
  label: CaptionKey;
  shots: Shot[];
}

export interface Camera { x: number; y: number; zoom: number }

/** 导演层要舞台做的事：FilmPlayer 实现，录片脚本用同一套。 */
export interface Stage {
  camera(next: Camera, ms: number): void;
  pose(next: Pose, ms: number): void;
  caption(key: CaptionKey | null): void;
  pointer(state: { x: number; y: number; pressed: boolean; visible: boolean; hold?: number }): void;
  shot(chapter: string, shot: string): void;
  /** 全黑遮罩：硬切时盖住换页、重置；`ms` 是淡入淡出时长。 */
  veil(on: boolean, ms: number): void;
}
