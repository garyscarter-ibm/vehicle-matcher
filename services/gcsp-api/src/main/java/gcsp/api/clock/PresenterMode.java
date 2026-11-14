package gcsp.api.clock;

/** How a presenter tick picks its target: one policy step, a named time or instant, or the next release cue. */
public enum PresenterMode {
    STEP,
    TO,
    NEXT_RELEASE
}
