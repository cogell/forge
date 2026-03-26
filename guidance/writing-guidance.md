# Forge: Writing Guidance Docs

How to create new guidance documents for the forge pipeline.

## The Core Rule

> A guidance doc teaches how to think about a problem. If it's telling you what to type, it belongs somewhere else.

---

## The Skeleton

Every guidance doc follows the same structure:

```
# Forge: <Name>

One-liner: what this doc is for and when it's used.

## The Core Rule

> A single quoted sentence that captures the non-negotiable principle.

---

## Process (or equivalent top-level sections)

Numbered steps, classification tables, or both.

---

## Anti-Patterns / Shortcuts Not Allowed

Table of bad → why it fails.
```

Not every section is required — `debugging.md` has no "Core Rule" label but opens with the same pattern. Match the content, not the formatting.

---

## What Goes Where

| Content type | Where it lives | Example |
|---|---|---|
| How to think about a problem | `guidance/<name>.md` | `debugging.md`, `tdd.md` |
| Agent prompt (what to do mechanically) | Embedded in `run-process.md` | Task agent, review agent, salvage agent |
| Document template (what the output looks like) | `templates.md` | PRD template, plan template |
| Pipeline command behavior | `plugin/commands/<name>.md` | `/forge:plan`, `/forge:run` |
| Skill definition (discovery + overview) | `skills/forge/SKILL.md` | The top-level skill |

If you're writing something and it keeps switching between "here's how to think about it" and "here's the exact prompt to send," split it. `run-process.md` is the model — the orchestration flow is guidance, the agent prompts are embedded but clearly fenced.

---

## Cross-References

When a guidance doc references another process, link to it:

```markdown
See [tdd.md](tdd.md) for the full protocol.
```

Do not duplicate content across guidance docs. If two docs need the same concept, one owns it and the other links to it. Pick the owner by asking: "where would someone look for this first?"

---

## When to Create a New Doc vs. Extend an Existing One

New doc when:

- The topic has its own core rule distinct from any existing doc
- It applies at a different point in the pipeline than existing docs
- It would make an existing doc serve two masters (e.g., adding PR review guidance to `run-process.md` when run-process is about orchestration)

Extend an existing doc when:

- The new content is a sub-case of an existing process (e.g., a new agent type in `run-process.md`)
- It only makes sense in the context of the existing doc
- A reader would expect to find it there

When in doubt, start by extending. Extract to a new doc when the existing one gets hard to navigate.
