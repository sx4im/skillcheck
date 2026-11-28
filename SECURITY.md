# Security policy

## Supported versions

Security fixes are applied to the latest published release of `@sx4im/skillcheck`
on npm. Older versions are not backported unless a critical issue warrants it.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Report privately via one of:

1. **GitHub Security Advisories** — use
   [Report a vulnerability](https://github.com/sx4im/skillcheck/security/advisories/new)
   on this repository (preferred).
2. **Email the maintainer** — contact listed on
   [https://github.com/sx4im](https://github.com/sx4im) if advisory filing is unavailable.

Include enough detail to reproduce the issue (affected version, environment, and
steps). You should receive an acknowledgement within a few days; we will
coordinate disclosure after a fix is available when possible.

## CLI and dashboard safeguards

- The CLI validates YAML metadata and bounds skill and model response sizes.
  Skill inputs and linked assets use canonical paths. Linked assets stay in the
  skill directory and are never executed by evaluation or audit.
- Local `.env` files can set documented credentials, model choices, and retry
  settings. Endpoint overrides and config locations must come from the shell or
  saved config. The CLI writes config through a private temporary file and
  renames it into place with mode `0600` on POSIX.
- Custom provider endpoints use HTTPS, with HTTP allowed for loopback. Provider
  connections reject link-local and known metadata addresses and fail on
  redirects. DNS results are checked at connection time.
- Reports and diagnostics mask recognizable credentials and remove terminal
  control sequences. Keep production secrets out of skill files and fixtures.
  Model-backed commands send task data to the provider you configure.
- The dashboard hashes issued API keys, limits requests by key and IP, and
  validates models, messages, and token budgets before metering. Existing
  plaintext key records migrate on first use. Copy a newly issued or rotated
  key when it is shown.
- Dynamic audits use simulated tools and synthetic data. The model request
  goes to the configured provider. Static audit and `doctor` without `--ping`
  run offline.
- CI checks lockfile integrity, dependency advisories, and CodeQL. The release
  workflow smoke-tests the tarball and verifies that npm provenance binds to
  its digest.

## Scope notes

- API keys and tokens stored by the CLI under `~/.config/skillcheck/` are local
  credentials — treat them like secrets and never commit them.
- The hosted dashboard proxies model calls; do not send production secrets into
  public issue trackers or sample skills.
