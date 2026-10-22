# Agent instructions

## Commit attribution

- Do not add Claude as a commit author or co-author. Never include a `Co-Authored-By: Claude ...` trailer, a "co-authored with Claude" credit, or a "Generated with Claude" signature in commit messages.
- Preserve human authorship and legitimate human co-author credits.
- Before committing, check the full commit message and remove any Claude attribution.

## Shared instructions

`AGENTS.md` is the canonical instruction file. `CLAUDE.md` is a relative symlink to it so both tools read the same rules. Keep the symlink rather than duplicating these instructions.
