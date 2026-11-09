import { el } from '../../vehicle-matcher/ui.js';

export const SYNTHETIC_NOTE = 'Synthetic example data.';
/** The one footer line that keeps a scenario screen identified as made-up data (styled by `.gcsp-synthetic`). */
export const syntheticNote = () => el('p', 'gcsp-synthetic', SYNTHETIC_NOTE);
