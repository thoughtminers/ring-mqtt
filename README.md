![ring-mqtt-logo](https://raw.githubusercontent.com/tsightler/ring-mqtt/dev/images/ring-mqtt-logo.png)

[![Security Audit](https://github.com/thoughtminers/ring-mqtt/actions/workflows/security-audit.yml/badge.svg)](https://github.com/thoughtminers/ring-mqtt/actions/workflows/security-audit.yml)
[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-support-yellow?logo=buy-me-a-coffee)](https://buymeacoffee.com/thoughtminers)

## Fork Notice

This is a security-hardened fork of [tsightler/ring-mqtt](https://github.com/tsightler/ring-mqtt).

### Why this fork exists

The upstream [ring-mqtt](https://github.com/tsightler/ring-mqtt) and its dependency [ring-client-api](https://github.com/dgreif/ring) both pull in `werift` (a WebRTC library) for live streaming support. `werift` and its dependency `werift-ice` depend on the `ip` package, which has a **high-severity SSRF vulnerability** ([GHSA-2p57-rm9w-gvfp](https://github.com/advisories/GHSA-2p57-rm9w-gvfp)) with **no fix available**.

Since ring-mqtt only uses Ring's alarm, device metadata, camera snapshots, and notification APIs — and never uses live streaming — this fork removes all streaming code and the `werift` dependency chain from **both** ring-mqtt and ring-client-api, eliminating these vulnerabilities entirely.

### Changes from upstream

- Removed all WebRTC/live streaming code (`lib/streaming/`, `lib/go2rtc.js`, `devices/camera-livestream.js`)
- Removed `werift` dependency (and its vulnerable transitive dependencies `ip`, `werift-ice`)
- Uses a [companion fork of ring-client-api](https://github.com/thoughtminers/ring) with the same streaming code removed
- Added `npm audit` CI workflow and Dependabot configuration

## About
Ring LLC sells security related products such as video doorbells, security cameras, alarm systems and smart lighting devices.  The ring-mqtt project uses the Ring API (the same one used by Ring official apps) to act as a bridge between these devices and a local MQTT broker, thus allowing any automation tools that can leverage the open standards based MQTT protocol to effectively integrate with these devices.

This fork uses [`@thoughtminers/ring-client-api`](https://www.npmjs.com/package/@thoughtminers/ring-client-api), a security-hardened fork of `ring-client-api` with all streaming/WebRTC code and vulnerable dependencies removed.

#### IMPORTANT NOTE - Please read
- Ring devices are cloud based devices and this project uses the same cloud based API used by the Ring apps. It does not enable local control of Ring devices as there is no known facility to do so.
- While using this project does not technically require a Ring Protect subscription, many capabilities are not possible without a subscription and this project is not intended as a way to bypass this requirement.
- **This fork does not support video streaming.** Live streaming, RTSP gateway, and video recording features have been intentionally removed to eliminate security vulnerabilities. If you need streaming, use the [upstream project](https://github.com/tsightler/ring-mqtt) at your own risk.

## Installation and Configuration
Please refer to the [upstream ring-mqtt project wiki](https://github.com/tsightler/ring-mqtt/wiki) for general documentation on installation methods and configuration options. Note that any streaming-related documentation does not apply to this fork.
