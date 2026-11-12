# Contributing

Thanks for your interest in contributing to a printemps-tokyo project.

## Development

1. Fork / clone the repository
2. `npm install`
3. Create a branch: `git switch -c feat/your-change`
4. Make your change and verify locally:
   ```bash
   npm run lint
   npm run typecheck
   npm test
   ```
5. Commit and open a pull request

## Code shared with the sibling tools

[ga4](https://github.com/printemps-tokyo/ga4), [gsc](https://github.com/printemps-tokyo/gsc)
and [sitepulse](https://github.com/printemps-tokyo/sitepulse) keep identical
copies of the service-account authentication, the HTTP retry and the Search
Console date helpers in `src/shared/`, with their tests in `test/shared/`.
Change a shared file in all of the repositories that have it, in the same way.
The list of shared files and the repositories that carry each one is at the
top of `scripts/check-shared.mjs`. `npm run check-shared` compares the local
copies with each sibling's `main` branch, and the Shared check workflow runs it
on every push to `main` and weekly. While a shared change is merged into one
repository after another, the check fails in the ones merged first until the
last one lands.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/) are preferred
(`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`).

## Pull requests

- Keep one PR focused on a single purpose
- CI (lint / typecheck / test / build) must be green
- Update the README and tests when behavior changes

## Bug reports and requests

Please open an [issue](../../issues) using the templates.
