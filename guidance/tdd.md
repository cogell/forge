# Forge: Test-Driven Development

Protocol for writing tests first. Used at two points in the pipeline: task authoring ([tasks-process.md](tasks-process.md)) and task execution ([run-process.md](run-process.md)).

---

## The Core Rule

> "If you didn't watch the test fail, you don't know if it tests the right thing."

Write the test before the implementation. Watch it fail before making it pass. No exceptions.

---

## Part 1: Writing TDD-Ready Tasks (authoring time)

A task can only be implemented test-first if it tells the task agent what to test. Acceptance criteria must be written as **observable behaviors**, not steps.

**TDD-unfriendly** (steps):
```
- [ ] Create the parseConfig function
- [ ] Handle missing fields
- [ ] Return errors array
```

**TDD-ready** (observable behaviors):
```
- [ ] parseConfig({}) → { ok: false, errors: ["name is required"] }
- [ ] parseConfig({ name: "foo" }) → { ok: true, config: { name: "foo" } }
- [ ] parseConfig({ name: 42 }) → { ok: false, errors: ["name must be a string"] }
```

Rules for TDD-ready acceptance criteria:

- Each criterion maps directly to one or more test assertions
- Specify inputs and expected outputs (or state changes) explicitly
- Cover happy path, error states, and edge cases — not just the sunny day
- If you can't write a test directly from a criterion, rewrite the criterion

The `design` field should include the interface the test will call — before the implementation exists:

```
design: "parseConfig(input: unknown): { ok: boolean; config?: Config; errors?: string[] }"
```

If the design field is vague, the test agent will guess. Don't make it guess.

---

## Part 2: The RED → GREEN → REFACTOR Cycle (execution time)

### RED — Write the failing test

1. Read the task's `acceptance_criteria` and `design` fields
2. Write tests that assert each acceptance criterion
3. Run the test suite — the new tests **must fail**
4. Check the failure mode:
   - **Assertion failure** — correct. Proceed to GREEN.
   - **Compile/type error on a new interface** — acceptable. The interface doesn't exist yet.
   - **Test passes without any implementation** — the test is wrong. Fix it before proceeding.

Watching the test fail is not a formality. It's the proof that the test is actually checking the right thing.

### GREEN — Minimum implementation

1. Write only the code needed to make the failing tests pass
2. No speculative code, no abstractions beyond what the tests require
3. If you find yourself handling a case not covered by the current tests — stop. Write the test for that case first.
4. Run the full test suite — all tests (old and new) must pass before moving on

### REFACTOR — Clean up

1. Confirm tests are green before touching anything
2. Apply the deep module principle: encapsulate complexity behind a simple interface
3. Remove duplication, improve naming, improve structure
4. Run tests after **each individual refactor** — never stack multiple changes before checking
5. Stop when tests are green and the code is clean. Do not gold-plate.

---

## Shortcuts That Are Not Allowed

| Shortcut | Why it fails |
|----------|-------------|
| Write implementation, then write tests | You can't watch the test fail; you may be testing the code, not the spec |
| Skip RED because "I know it'll fail" | Sometimes it won't — revealing a misunderstood requirement |
| Skip REFACTOR because "tests are green" | Green is not the goal. Clean and green is the goal. |
| Write a test that can always pass | Useless. A test that can never fail provides no safety net. |
| Test implementation details instead of behavior | Tests should survive refactoring; if they break during cleanup, they're coupled to the wrong layer |
| "I'll add tests later" | Later never comes. If you can't write a test now, you don't understand the requirement well enough to implement it. |

---

## When There Is No Test Infrastructure

If the project has no testing setup, the **first task of Phase 1** must create it. Do not start any other task.

That task:
- `description`: "Set up test infrastructure"
- `acceptance_criteria`: At least one example test running and passing via `<test command>`
- `priority`: Critical (0) — everything else depends on it
- Has no parent epic dependency — it unblocks all other tasks

Do not accept "we'll add tests after the feature works." Tests are part of the feature.
