package gcsp.api.learning;

import gcsp.api.persistence.RunContext;

/** The instant and clock version a learning read is projected at; the presenter demo clock replaces the default (FUCQ-479). */
public interface LearningClock {

    /** now is ISO text; clockVersion is a non-empty String or a positive integer. */
    record Reading(String now, Object clockVersion) {}

    Reading now(RunContext context);
}
