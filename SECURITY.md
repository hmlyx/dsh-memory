# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| 3.0.x | ✅ |

## Reporting a Vulnerability

This plugin runs inside DeepSeek Harness on the user's local machine. It:

- stores user memory as plain Markdown files under the workspace `对话记忆/` directory;
- opens a local HTTP endpoint (`/__memory/*`) reachable only from the same machine;
- enforces per-AI privacy: each AI's global/brief records are private to that AI.

If you find a security issue (for example, the HTTP endpoints being reachable
from outside, or private memory being exposed), please report it privately by
opening a GitHub issue with the `security` label, or contact the maintainer
via the repository's issue tracker. Do not post exploit details publicly
before a fix is available.
