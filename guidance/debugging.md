# Forge: Systematic Debugging

Protocol for diagnosing failures before attempting fixes. Used by the salvage agent; applies equally when a human is debugging.

---

## The Core Rule

> Understand the failure before you touch any code. A fix applied without a confirmed hypothesis is a guess — and guesses compound.

---

## Step 1: Classify the Failure

Read the error output and assign it to one category. The category determines what to investigate.

| Type | Signs | Investigate |
|------|-------|-------------|
| **Assertion failure** | Test ran, expected X, got Y | Implementation logic — trace back from the wrong output |
| **Type / compile error** | Build failed before tests ran | Interface mismatch — compare the call site to the type definition |
| **Runtime crash** | Exception or unhandled error mid-execution | Stack trace — find the first frame in code you own |
| **Import / dependency error** | Module not found, cannot resolve | File paths, package install, circular deps |
| **Test infrastructure failure** | Test runner itself errored, no tests ran | Test config, environment setup — not the implementation |

If the failure doesn't fit cleanly, pick the closest category and note the ambiguity.

---

## Step 2: Reproduce It

Before changing anything, confirm you can trigger the failure reliably:

```bash
<test command> --<filter flag> "<failing test name>"
```

If you cannot reproduce it consistently, the failure is environment-dependent. Fix the environment first — do not attempt to fix code that may already be correct.

---

## Step 3: Narrow the Scope

Binary search the problem space. Start broad, then cut in half:

- Which test file?
- Which specific test case?
- Which assertion within that test?
- Which input triggers it?

For an assertion failure: compare expected vs actual. Work backwards from the wrong value — where did it first diverge from what was expected?

For a type error: find the exact line and the exact mismatch. Read both sides of the type boundary.

For a runtime crash: read the stack trace top-to-bottom. Find the first frame in code you own — that's where to look, not in library internals.

---

## Step 4: Form One Hypothesis

Write it down before testing it. A good hypothesis is:

- **Specific**: "the parser returns `null` when input is an empty object instead of `{ ok: false, errors: [...] }`"
- **Falsifiable**: you know exactly what to check to confirm or refute it
- **Single-cause**: one hypothesis at a time

A bad hypothesis: "something is wrong with the error handling."

If you have multiple candidate hypotheses, rank by likelihood and test them in order — one at a time.

---

## Step 5: Test the Hypothesis

Make exactly one change to test your hypothesis. Run the failing test:

- **Hypothesis confirmed** (test now passes): the root cause is found. Proceed to fix properly.
- **Hypothesis refuted** (test still fails, different error): you learned something. Update your hypothesis and repeat from Step 4.
- **Hypothesis refuted** (test still fails, same error): your change didn't reach the problem. Narrow scope further.

Never change two things simultaneously. If it passes, you won't know which change fixed it — and you may have introduced a compensating bug.

---

## Step 6: Confirm the Root Cause Fix

Before calling it done:

1. Run the full test suite — not just the previously failing test
2. Ask: "could the same bug exist with different inputs not covered by these tests?" If yes, add a test for it.
3. Ask: "is my fix addressing the root cause, or masking a symptom?" A symptom fix makes the test pass but leaves the underlying problem intact.

---

## Anti-Patterns

| Anti-pattern | Why it fails |
|-------------|-------------|
| Change multiple things at once | You won't know what fixed it |
| Fix before reproducing | You may be fixing the wrong thing |
| Read only the last line of the error | Stack traces and context matter — read the whole thing |
| Assume the test is correct | Tests can be wrong. If implementation matches the spec but fails the test, the test may be the bug |
| Add logging everywhere first | Narrow scope first, then add targeted logging only where your hypothesis points |
