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

## Scope notes

- API keys and tokens stored by the CLI under `~/.config/skillcheck/` are local
  credentials — treat them like secrets and never commit them.
- The hosted dashboard proxies model calls; do not send production secrets into
  public issue trackers or sample skills.
