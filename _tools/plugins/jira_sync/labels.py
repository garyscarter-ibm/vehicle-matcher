"""jira_sync default plugin (SCAF-70): reads the kind:<code|data|ui|docs> and size:<XS|S|M|L|XL> labels of a Jira issue.
Kit behaviour moved out of jira_sync's core into the first story-field hook, so the hook is used from day one. ALWAYS_ON:
it runs in every project. The allowed values (KINDS, SIZES) and the defaults (code, M) stay in jira_sync.py; a label with
any other value, or none, gives no answer here and the story gets the default. Only the kit's own plugins may answer for
kind and size; a project extension cannot."""
ALWAYS_ON = True
PROVIDES = ("story_fields",)


def story_fields(root, issue, ctx):
    out = {}
    for field, allowed in (("kind", ctx["kinds"]), ("size", ctx["sizes"])):
        value = ctx["label_value"](issue["labels"], field + ":", allowed)
        if value:
            out[field] = value
    return out
