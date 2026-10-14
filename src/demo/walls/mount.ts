import { createApp, type Component } from 'vue';
import GlassWall from './GlassWall.vue';
import CardWall from './CardWall.vue';
import type { FilmWall } from '../presentation';

const WALLS: Record<FilmWall, Component> = { glass: GlassWall, cards: CardWall };

/** 把一面展示墙挂到演示页最上层（独立的小 Vue 应用；文案、主题、颜色都是模块级状态，跟主应用同步）。 */
export const mountWall = (kind: FilmWall): { unmount(): void } => {
  const host = document.createElement('div');
  host.className = 'film-wall-host';
  document.body.append(host);
  const app = createApp(WALLS[kind]);
  app.mount(host);
  return { unmount() { app.unmount(); host.remove(); } };
};
