# Security Policy

## Supported versions

Only the latest release of each app (CLI, desktop, web) receives security fixes.
This project is pre-1.0, so please upgrade to the latest version before reporting.

## Reporting a vulnerability

Please report vulnerabilities privately. Do not open a public issue or pull request.

Use GitHub's private reporting: go to the
[Security tab](../../security/advisories/new) and choose **Report a vulnerability**.

Helpful details to include:

- Which app is affected (CLI, desktop, or web) and its version
- Steps to reproduce, or a proof of concept
- What an attacker could achieve (the impact)

## What to expect

- **Acknowledgement:** within 7 days of your report.
- **Updates:** I'll keep you informed as I investigate and work on a fix.
- **Credit:** with your permission, you'll be credited in the published advisory.

This is a solo-maintained project, so these are good-faith targets, not guarantees.

## Disclosure

I follow coordinated disclosure with a 90-day window, counted from the date of your report.
Please keep details private until a fix is released or the window ends, whichever comes first.
The window can be extended by mutual agreement if a fix needs more time, and shortened if the
issue is being actively exploited.

## Scope

In scope: vulnerabilities in the code in this repository that affect users of the
CLI, desktop, or web app.

Out of scope: issues that require an attacker who already has full access to the
user's machine or account, and vulnerabilities in third-party dependencies that
have no impact on this project (please report those upstream).
