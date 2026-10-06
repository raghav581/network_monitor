# Network Monitor

A static web app that checks network health **from the browser on the machine you're using** — no install required after you host or run it locally.

## What it checks

| Layer | Check |
|-------|--------|
| L1 Device | Browser online state, Network Information API (when supported) |
| L2 Local LAN | Inferred gateway/router hints (browsers cannot ping the router) |
| L3 DNS | DNS-over-HTTPS resolution via Cloudflare |
| L4 TCP/IP | HTTPS to `1.1.1.1` (routing without DNS) |
| L5 Internet | Multiple public endpoints (Google, Cloudflare) |
| L6 TLS | HTTPS certificate path to Cloudflare |
| L7 Performance | Median RTT to CDN |

The summary points to the **first failing layer** in the stack to narrow down where to troubleshoot.

## Run locally

```bash
npm install
npm run dev
```

Open the URL shown in the terminal (usually `http://localhost:5173`).

## Deploy for anyone to use

```bash
npm run build
```

Upload the `dist/` folder to any static host (Netlify, Vercel, GitHub Pages, S3, etc.). Each visitor runs checks against **their** network.

## Limits

- No ICMP ping or traceroute (browser security).
- VPNs, proxies, and browser extensions can skew results.
- Corporate SSL inspection may fail the TLS check even when browsing works.
