# GCSP HLD agreement — 4 November 2026

Russell accepted Gary's recommendations on all five FUCQ-6 review items referred for his agreement: **“I will follow GC's recommendations on each.”** This answers Gary's review comment `132017`, updated on 4 November 2026. The review is recorded in `docs/design/hld-review-gc.md` on branch `claude/hld-review-questions-310ecd`, commit `dbc4f18`.

These decisions take precedence over conflicting wording in the earlier HLD, blueprint and story-authoring records. Apply them when aligning the canonical design and existing implementation stories through the normal workflow.

| Review item | Agreed decision |
|---|---|
| Q5 · FUCQ-8 sequencing | FUCQ-21 (retail baseline) and FUCQ-26 (typed purchase-price versus points terms) go first. The employee policy calls `rankCars()` directly, retaining exact-car evaluation before grouping. FUCQ-22–25 may proceed in parallel. FUCQ-27/28 move to **after 12 November 2026**, protected by the retail baseline. This is an explicit exception to the earlier full-build timing direction for these two stories. |
| Q7 · VIN lookup | The backend uses the lookup module in process through its port. The HTTP endpoint wraps the same module; contract tests establish equivalent results. The backend does not need to call its own HTTP endpoint. |
| Q13 · Vehicle identity | Identify synthetic scheme stock by order reference plus configuration. Only delivered/current cars, including Paula's current car, carry a VIN. Re-scope FUCQ-19/20 accordingly and retain the distinct-configuration corpus. |
| Q14 · Integration target | Point future BMW integration gates and adapter contracts at the target AWS platform. Preserve the distinction between current implementation, the integration target and functioning synthetic demo behaviour. |
| Q16 · Paula's step 07 | After declining, Paula confirms one preference change, such as body style or an essential requirement, rather than lowering a Choices cash-contribution ceiling. |

The [build rules](build-rules.md), central versioned policy source and [experience quality contract](experience-quality.md) continue to apply. The Q5 exception concerns the two named extraction stories; the remaining planned capabilities retain the existing build direction.

Gary's other recorded review decisions remain the implementation context. The GC-001 dashboard facts remain with Gary: Render/Pages ownership, Render's deployed branch/revision and plan, whether `DEMO_ACCESS_KEY` is configured, and ownership/consumers of `EDS_SYNC_TOKEN`. Confirm secret presence or ownership without retrieving or publishing secret values.

This record captures the agreement and its precedence. Updating the canonical diagram, technical narrative and affected story acceptance/dependencies remains work in their existing design/story lanes; this approval response does not establish that those amendments or the application implementation are complete.
