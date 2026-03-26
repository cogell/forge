---
description: Set up plans/ and docs/ directory structure with templates
argument-hint:
---

Run `forge init` to scaffold the project structure.

If the CLI is not available, create the following directories and templates:

```
plans/_template/prd.md
plans/_template/plan.md
plans/_archive/
docs/decisions/template.md
docs/guides/
docs/reference/
```

Before creating anything:
1. Check for existing docs/, plans/, specs/, wiki/ directories
2. Check README.md length (>200 lines = content should move to docs/)
3. Present the proposed structure and confirm with the user
