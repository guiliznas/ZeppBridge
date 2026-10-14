import type { Chapter } from '../types';
import { lookIntro, prologue } from './look';
import { lookCards } from './cards';
import { lookSwitches } from './switches';
import { connect } from './connect';
import { read } from './read';
import { ai } from './ai';
import { finale, settings } from './settings';

/** 第一章 外观（计划 1.1–1.8）。 */
const look: Chapter = { id: 'look', label: 'chapterLook', shots: [...lookIntro, ...lookCards, ...lookSwitches] };

/** 整片的章节顺序（计划第四节）。章节条按这个顺序画，跳章从章首重来。 */
export const FILM: Chapter[] = [prologue, look, connect, read, ai, settings, finale];
