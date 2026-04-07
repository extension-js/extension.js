# AI Handoff Documents

Use these documents when resuming the reload/content-script work with another agent.

Recommended order:

1. Read `docs/ai-handoffs/2026-04-06-reload-handoff-status.md`
2. Read `docs/ai-handoffs/2026-04-06-css-modules-blocker-playbook.md`
3. Then continue from the "Next actions" section in the blocker playbook

Suggested prompts:

- `Read docs/ai-handoffs/2026-04-06-reload-handoff-status.md and keep going`
- `Read docs/ai-handoffs/2026-04-06-css-modules-blocker-playbook.md and keep going`
- `Read docs/ai-handoffs/README.md, then the two linked docs, and keep going`

What these documents contain:

- The reload project status and what is already believed to be complete
- The current Chromium blocker around `content-css-modules`
- Exact evidence from the last failing runs
- The files touched in the last session
- The most likely next debugging path, in priority order

If more historical context is needed after reading these docs, consult the transcript path already captured in the status document instead of re-discovering the full chat history from scratch.
