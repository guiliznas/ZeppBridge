import type { Chapter } from '../types';
import { look, prologue } from './look';

/** 整片的章节顺序（计划第四节）。章节条按这个顺序画，跳章从章首重来。 */
export const FILM: Chapter[] = [prologue, look];
