# Repository Guidelines

## Project Structure & Module Organization

This repository currently contains planning documentation, not an implemented application. Read `docs/requirements.md`, `docs/architecture.md`, `docs/security.md`, and `docs/deployment.md` before implementing features. `README.md` is the documentation entry point. Planned directories are `apps/web/`, `apps/api/`, `packages/contracts/`, `packages/locales/`, `worker/`, `db/`, and `ops/`. Update documentation when implementation decisions change.

## Build, Test, and Development Commands

No toolchain or runnable commands exist yet. Commands in the deployment guide are proposed interfaces, not available scripts. When introducing tooling, document reproducible installation, development, build, migration, and test commands in `README.md`. Commit dependency lockfiles.

## Coding Style & Naming Conventions

The planned stack uses TypeScript for web/API and Python for the worker. Use descriptive names, focused modules, and shared protocol schemas. Configure ESLint and Prettier with the initial JavaScript tooling; follow standard Python conventions. Avoid unrelated formatting changes.

## Localization Requirements

Communicate with the repository owner in Russian. Implement every user-facing message in Russian and English immediately: buttons, errors, validation, statuses, accessibility labels, worker messages, and installation instructions. Use translation keys instead of hard-coded UI text. Add matching keys and interpolation parameters in both locales in the same change.

Keep the website/account language independent from the clicker remote language. Speaker invitation creation must include a remote language selector. Localization means displaying the selected language, not both translations simultaneously.

## Testing Guidelines

Planned frameworks are Vitest, Playwright, and pytest; none is configured yet. Test behavior, isolation between users, authorization, abuse limits, reconnection, command deduplication, version compatibility, and localization independence. No coverage threshold is established. Use deterministic tests without private credentials.

## Commit & Pull Request Guidelines

No Git history establishes conventions. Use short imperative subjects, such as `Add device pairing`. Pull requests should describe behavior, relevant issues, validation, configuration changes, and screenshots for interface changes.

## Security & Deployment

Implement server authorization and abuse limits alongside exposed features. Never treat device UUIDs as credentials or commit secrets. Deployment is manual: SSH, GitHub pull, dependencies/build, migrations when needed, then PM2 restart. Use existing Nginx; do not introduce Docker, Caddy, or automatic deployment workflows.
