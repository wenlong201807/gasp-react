import type { Preset } from '../types';
import { presetAwait } from './preset-await';
import { presetBasic } from './preset-basic';
import { presetRender } from './preset-render';

export const presets: Preset[] = [presetBasic, presetAwait, presetRender];
