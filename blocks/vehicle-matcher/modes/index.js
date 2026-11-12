/*
 * Interface "mode" registry: a mode is { key, label, mount(root, ctx) }.
 * Only the questionnaire remains; add a modes/<key>.js and an entry here for more.
 */

import questionnaire from './questionnaire.js';

export const MODES = [questionnaire];

export const DEFAULT_MODE = MODES[0];

export const modeByKey = (key) => MODES.find((m) => m.key === key);
