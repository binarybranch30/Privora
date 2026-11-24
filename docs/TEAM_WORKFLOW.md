# Team workflow

| Owner | Files and responsibilities |
| --- | --- |
| Gateway | MCP SDK transport, restricted tool, downstream and integration tests |
| Policy monitoring | Fetch behavior, normalization, clause extraction and fixtures |
| Security and data | Rule engine, schema, migrations, admin review and evidence |
| Dashboard | Workflow, audit presentation and responsive browser checks |
| Release and demo | CI, setup, clean-room rehearsal and presentation |

Agree on the MCP and API contracts when changing DTOs. Test rule decisions separately from actual analyzer delivery, and use the receipt count in rehearsals. Keep secret values in local environment configuration.

Before the event, rehearse the scripted sequence on the presenting machine, verify fixture-only use, check live CI, assign speakers, and decide whether to show the optional administrator review.
