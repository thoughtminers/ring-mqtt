# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| latest  | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please report it responsibly:

1. **Do not** open a public GitHub issue for security vulnerabilities
2. Email the maintainer or use [GitHub's private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
3. Include a description of the vulnerability, steps to reproduce, and potential impact

We will acknowledge receipt within 48 hours and aim to provide a fix or mitigation within 7 days for critical issues.

## Security Measures

This fork takes the following security measures:

- **Dependency auditing**: `npm audit` runs on every PR and weekly via GitHub Actions
- **Automated dependency updates**: Dependabot monitors for vulnerable dependencies
- **Reduced attack surface**: Unused WebRTC/streaming dependencies (`werift`, `werift-ice`, `ip`) have been removed to eliminate known high-severity vulnerabilities
