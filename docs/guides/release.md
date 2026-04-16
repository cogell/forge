# Releasing Forge

Forge is distributed as a **local Claude Code marketplace**. There's no npm registry, no GitHub Releases, no install server — this repo *is* the marketplace. Users clone it once and `git pull` to upgrade.

A "release" is therefore just a commit on `main` that bumps the version files. Claude Code detects the version change in the plugin manifest and prompts users to reload.

## The three version files

Forge has three versioned surfaces that **must stay in lockstep**:

| File | Consumed by |
|---|---|
| `.claude-plugin/marketplace.json` | Claude Code — reads this to list plugins in the marketplace |
| `plugin/.claude-plugin/plugin.json` | Claude Code — compares against installed version to detect updates |
| `package.json` | The CLI build (`pnpm build` → `bin/forge`) |

If the plugin manifest version doesn't change, Claude Code won't pick up your edits to commands or guidance — the user will keep running the old copy until they manually reinstall. Bumping only one of the three is the most common foot-gun.

## When to bump — semver for a CLI+plugin

Forge version numbers cover *both* the CLI and the plugin together. Pick the bump type based on the most impactful change in the release:

- **Patch** (`0.2.0` → `0.2.1`): bug fixes, typo fixes, internal refactors, guidance wording tweaks that don't change the process.
- **Minor** (`0.2.0` → `0.3.0`): new slash commands, new CLI subcommands, new flags, new guidance docs, additive changes to the pipeline.
- **Major** (`0.2.0` → `1.0.0`): breaking changes — renamed/removed commands or flags, changes to the `plans/` or `docs/` directory layout, changes to `forge status --json` output shape (the SessionStart hook consumes this), or any change that forces users to migrate existing feature folders.

When in doubt, bump minor. Patch is for changes a user would never notice.

## Release checklist

From a clean working tree on `main`:

1. **Verify the build is green**
   ```bash
   pnpm typecheck
   pnpm build
   pnpm test
   ```
2. **Bump all three version files to the same number** (see list above).
3. **Update `CHANGELOG.md`** — add a section for the new version summarizing user-facing changes. Link to PRs where useful. If `CHANGELOG.md` doesn't exist yet, create it with a `## [unreleased]` section at the top.
4. **Commit** with a message like `release: v0.3.0`. Keep the version bump as its own commit — don't bundle it with feature work.
5. **Push to `main`**.

That's the release. Users on `git pull` will get it on their next Claude Code restart.

## How users upgrade

Users who installed via `claude plugin marketplace add /path/to/forge`:

1. `cd /path/to/forge && git pull`
2. Restart Claude Code (or run `/plugin` and reinstall).

Claude Code compares the installed plugin's version against `plugin.json` and surfaces the update. The CLI is picked up automatically since `bin/forge` is symlinked into `PATH`.

Users who installed via skillshare need an extra step:

```bash
skillshare sync
```

## Gotchas

- **The SessionStart hook runs `forge status --json` on every Claude Code startup.** If a release breaks the shape of that output, every project that has forge installed starts the session with a broken hook. Treat `forge status --json` as a stable public API — bump major for output changes.
- **Restart required.** Claude Code reads the plugin manifest at session start. Users won't see plugin changes until they restart, even after `git pull`.
- **`bin/forge` is a build artifact.** Commit it after running `pnpm build` so users who install via `ln -s` get the new binary on `git pull` without having to build locally. Don't forget this step — it's easy to miss since local dev uses `pnpm dev`.
- **Guidance doc edits are plugin changes.** Slash commands reference `guidance/*.md` files. Editing those changes plugin behavior, so bump the version even for "docs only" edits inside `guidance/`.
- **Plain `docs/` edits are not plugin changes.** The `docs/` directory (like this file) is for humans reading the repo — no version bump needed for changes here.

## Optional: git tags

Tags aren't part of the standard ritual. Add one when you need:

- **Rollback** — `git checkout v0.2.0` to unstick a user hit by a regression on `main`.
- **Pinned install** — `git clone --branch v0.3.0` for users who want stability over latest.
- **GitHub Releases** — if forge ever grows a public release page with downloadable snapshots.

To tag a release after pushing:

```bash
git tag v0.3.0
git push --tags
```
