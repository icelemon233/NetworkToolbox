<p align="center"><img src="assets/icon-readme.png" width="128" alt="NetworkToolbox"></p>

# NetworkToolbox

English | [简体中文](./README.zh-CN.md)

A Windows network toolbox for Wi-Fi channel analysis, connection diagnostics, throughput tests, device discovery, local configuration and Xiaomi router management. The interface is in Simplified Chinese, with light and dark themes and a system tray.

## Run

[Download the Windows release](https://github.com/icelemon233/NetworkToolbox/releases/latest).

The v0.2.2 installer and portable build include the updated interface.

Windows 11 x64 is required. The portable application and installer include Electron and a self-contained .NET worker; end users do not need Node.js or a .NET installation.

- `NetworkToolbox-<version>-Portable.exe`: run directly.
- `NetworkToolbox-Setup-<version>.exe`: install with a choice of destination.
- Closing the window keeps tasks in the tray by default. In v0.2.2, settings also offer exit on close. Choose **退出应用** in settings or **退出** in the tray menu to exit.

Opening the app reads local interfaces and the Windows Wi-Fi cache. Active Wi-Fi scans, Internet tests, subnet discovery and background monitoring start when requested.

## Tools

| Area | Functions |
| --- | --- |
| Overview | Interfaces, IPv4/IPv6 addresses, DNS, gateway, proxy, negotiated link rates and interface traffic |
| Wi-Fi | 2.4/5 GHz channel and advertised bandwidth plots, RSSI, AP-reported load, overlap suggestions and monitoring; 6 GHz details depend on hardware |
| Diagnostics | Continuous Ping, loss, adjacent successful RTT differences, P95, IPv4 trace, TCP ports, HTTP/TLS timings and certificates |
| DNS | A/AAAA/CNAME/MX/NS/TXT/SOA, comparison of up to six UDP DNS servers and local DNS cache flush |
| Throughput | Cloudflare-compatible download/upload tests, HTTP latency under load and keyed LAN upload/download tests |
| Local network | Discovery within an attached private IPv4 subnet, hostnames, neighbor cache, offline IEEE vendor lookup, TCP/UDP process endpoints and optional ETW process traffic |
| Configuration | IPv4/IPv6 DNS, static IPv4/DHCP, IPv4 MTU, current-user proxy/PAC, adapter state, previews and encrypted rollback snapshots |
| Xiaomi | AX3000T / RD03 / CN / 1.0.84: wireless settings, client access and limits, blacklist, DHCP, reservations, single-port forwarding, status and reboot |
| Capture | Windows Packet Monitor, circular capture, pcapng export and basic Ethernet/IP/TCP/UDP/ARP inspection |
| Utilities and records | Subnet calculator, Wake-on-LAN, public IP, routing table, up to 500 local records, snapshot comparison and HTML reports |

## Measurement and permissions

![Light-theme DNS query page in the Windows read-only preview](docs/interface-light.png)

The read-only Windows preview, showing the DNS query page before a test starts.

New Windows versions may require location services and desktop-app location permission for nearby Wi-Fi scans. The app reports denied access; administrator rights do not replace that permission.

Wi-Fi plots use access-point broadcasts. Missing bandwidth stays unknown and appears as a dashed position marker. Channel suggestions estimate overlap among visible networks, rather than measuring full-spectrum noise. AP utilization is the AP's own reported value. Active scans coordinate with Ping to avoid contaminating latency samples.

Configuration changes have a preview. Only individual privileged operations request elevation; the main window runs normally. The user proxy tool does not change WinHTTP's separate proxy settings. Stopping a task or exiting normally retains partial measurements.

## Xiaomi AX3000T

Enter the local management address and administrator password in the router page. Remembering the password is optional and uses Windows current-user DPAPI. Passwords and session tokens stay in the native service and are omitted from ordinary history and reports.

The adapter follows the original templates for firmware 1.0.84. Wireless writes preserve both radios and existing passwords, and refuse to proceed when required fields or channel choices cannot be read safely. Expired or repeated plans are rejected. A write timeout requires a read-back check before retrying.

Public identity has been checked against a real router. Authentication and write contracts have been tested with a local fixture; real login and writes still require manual credentials and device verification. Other models or firmware versions retain the original management-page entry point.

## Data and network services

Records are stored in `%APPDATA%\NetworkToolbox`. The stable application ID and data folder are retained across the Cinna conversion. Configuration plans, rollback snapshots and remembered credentials use Windows current-user protection. History and reports remove common credentials, cookies and URL query values, but can still contain network names and device addresses. Packet captures retain actual traffic.

The bundled IEEE MA-L/MA-M/MA-S lookup stays offline; locally administered MAC addresses are identified separately. Internet throughput tests use `speed.cloudflare.com`, and public-IP lookup uses ipify. These requests run only when requested. LAN tests require the same application on the peer; the protocol is not compatible with iperf.

The installer asks a running current version to exit normally and stops if cleanup cannot be confirmed. Uninstalling preserves local application data and unrelated files added to the installation directory.

## Build and verification

Development requires Node.js 24, pnpm 11.25.0 and the .NET 10 SDK.

```powershell
pnpm install --frozen-lockfile
./scripts/build.ps1 -Package
```

Use `-Dotnet <path>` if the SDK is outside PATH. Build and test commands are documented in [development](docs/development.md). See [validation scope](docs/validation.md) for the distinction between live tests, protocol fixtures and pending elevated/device operations, and [router sources](docs/router-adapter.md) for firmware evidence.

This is a local unsigned Windows build. Cinna-series identity and resource derivation are recorded in [branding](docs/branding.md).
