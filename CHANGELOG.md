# Changelog

All notable changes to Forge are documented here. See `docs/guides/release.md` for how releases work.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to semver for the combined CLI + plugin.

## [Unreleased]

- Align `package.json` version with the plugin manifest — all three version files (`marketplace.json`, `plugin.json`, `package.json`) are now the source-of-truth trio.

## [0.2.0]

First marketplace-installable release. The repo is now a local Claude Code marketplace; users install via `claude plugin marketplace add` + `claude plugin install forge`.

### Added

- Built-in task system (`forge tasks`) replacing the external beads/bd dependency.
- `forge reflect` — capture implementation learnings after shipping.
- `forge retro` — root cause analysis when a reviewer finds issues on a "ready" PR.
- Review gate protocol with severity-based advancement criteria.
- `needs-reflection` pipeline stage — enforces reflection before docs graduation.
- Expanded `forge tasks` subcommands: `--blocked-by`, `--label`/`--phase` filters on `ready`, `--children`/`--full` on `show`, `--id` on `epic create`, `--replace` on `update --acceptance`, `delete` with descendant scan.
- Writing voice and meta-guidance docs for authoring new guidance.
- Value framework and execution strategy guidance.

### Changed

- Repo restructured around `plugin/` for marketplace install; `skills/forge/` removed in favor of the plugin as the sole distribution surface.
- Brainstorm is now optional; review gates are judgment-based rather than mechanical.
- `--help` on all `forge tasks` subcommands.

### Fixed

- Short flags (`-p`, `-l`, `-a`) on `forge tasks create`.
- YAML frontmatter parse error in the docs command.

## [0.1.0]

Initial scaffold — Bun CLI, Claude Plugin structure, and first-pass guidance docs.
