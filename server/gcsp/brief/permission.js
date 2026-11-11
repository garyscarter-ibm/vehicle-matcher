// Search and hold share one Buddy switch, including legacy records with partial grants.
export const isBuddyEngaged = (buddy) => buddy?.searchConsent === true && buddy.holdConsent === true && buddy.paused === false;
