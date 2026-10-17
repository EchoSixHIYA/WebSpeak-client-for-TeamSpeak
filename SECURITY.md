# Security Policy

## Reporting a vulnerability

WebSpeak runs on servers that are typically internet-facing and relays voice traffic,
so we take security reports seriously.

Please **do not open a public issue** for a vulnerability. Instead, report it privately
using GitHub's [private vulnerability reporting](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/security/advisories/new)
(click "Report a vulnerability").

Include, if possible:

- A clear description of the issue and its impact.
- Steps to reproduce, including a minimal configuration and affected version.
- Any suggested fix or workaround.

We will acknowledge your report as soon as possible and aim to publish a fix and
advisory once it is confirmed.

## Supported versions

Only the latest release on the default branch (`master`) receives security fixes.
Older releases and pre-release builds are not supported.

## Scope

- Server gateway and admin console (`src/`)
- Browser client and skin runtime (`web/`)
- Docker image and deployment templates (`Dockerfile`, `docker-compose.yml`)

Out of scope: issues that require an attacker to already have full access to the host,
or misconfigurations of a self-hosted deployment (for example, exposing the admin
console without TLS in front of it).

## Expectations

This is a community-maintained project. We strive to respond promptly but cannot
offer a fixed SLA. If you can, please include a patch in your report — it speeds
up remediation considerably.
