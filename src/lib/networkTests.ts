interface NetworkInformation {
  effectiveType?: string
  downlink?: number
  rtt?: number
}

export type TestStatus = 'idle' | 'running' | 'pass' | 'fail' | 'warn' | 'skip' | 'info'

export interface NetworkTest {
  id: string
  layer: number
  layerName: string
  title: string
  description: string
  browserLimitation?: string
}

export interface TestResult {
  id: string
  status: TestStatus
  latencyMs?: number
  detail: string
  suggestion?: string
}

export const NETWORK_TESTS: NetworkTest[] = [
  {
    id: 'browser-online',
    layer: 1,
    layerName: 'Device',
    title: 'Browser online state',
    description: 'Whether the browser reports an active network interface.',
  },
  {
    id: 'connection-quality',
    layer: 1,
    layerName: 'Device',
    title: 'Link quality (if available)',
    description: 'Effective connection type and estimated downlink from the Network Information API.',
  },
  {
    id: 'local-gateway',
    layer: 2,
    layerName: 'Local LAN',
    title: 'Local router / gateway',
    description: 'Reachability of your home router is inferred when public sites fail but DNS still works.',
    browserLimitation:
      'Browsers cannot send ICMP ping to your router. We infer LAN issues from the pattern of other checks.',
  },
  {
    id: 'dns',
    layer: 3,
    layerName: 'DNS',
    title: 'DNS resolution',
    description: 'Resolve a hostname via DNS-over-HTTPS (Cloudflare).',
  },
  {
    id: 'tcp-ip',
    layer: 4,
    layerName: 'TCP / IP',
    title: 'Direct IP reachability',
    description: 'HTTPS to a well-known IP (1.1.1.1) to test routing without relying on DNS.',
  },
  {
    id: 'internet',
    layer: 5,
    layerName: 'Internet',
    title: 'Internet connectivity',
    description: 'HTTP checks to multiple independent endpoints (Google, Cloudflare).',
  },
  {
    id: 'tls',
    layer: 6,
    layerName: 'TLS',
    title: 'HTTPS / TLS',
    description: 'Valid TLS handshake to a trusted certificate.',
  },
  {
    id: 'latency',
    layer: 7,
    layerName: 'Performance',
    title: 'Round-trip latency',
    description: 'Median response time to a stable CDN endpoint.',
  },
]

const FETCH_TIMEOUT_MS = 12_000

async function timedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<{ ok: boolean; latencyMs: number; status?: number; error?: string }> {
  const start = performance.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(input, {
      ...init,
      signal: controller.signal,
      cache: 'no-store',
      mode: 'cors',
    })
    const latencyMs = Math.round(performance.now() - start)
    return { ok: res.ok || res.type === 'opaque', latencyMs, status: res.status }
  } catch (e) {
    const latencyMs = Math.round(performance.now() - start)
    const message = e instanceof Error ? e.message : 'Request failed'
    return { ok: false, latencyMs, error: message }
  } finally {
    clearTimeout(timer)
  }
}

export interface RunContext {
  onProgress: (id: string, partial: Partial<TestResult>) => void
}

export async function runAllTests(ctx: RunContext): Promise<Map<string, TestResult>> {
  const results = new Map<string, TestResult>()

  const set = (id: string, result: TestResult) => {
    results.set(id, result)
    ctx.onProgress(id, result)
  }

  const markRunning = (id: string) => {
    set(id, { id, status: 'running', detail: 'Checking…' })
  }

  // Layer 1 — browser online
  markRunning('browser-online')
  const online = navigator.onLine
  if (!online) {
    set('browser-online', {
      id: 'browser-online',
      status: 'fail',
      detail: 'navigator.onLine is false',
      suggestion: 'Enable Wi‑Fi or Ethernet, or turn off airplane mode. Then run the scan again.',
    })
  } else {
    set('browser-online', {
      id: 'browser-online',
      status: 'pass',
      detail: 'Browser reports online',
    })
  }

  // Connection quality
  markRunning('connection-quality')
  const conn = (navigator as Navigator & { connection?: NetworkInformation }).connection
  if (conn) {
    const parts = [
      conn.effectiveType && `type: ${conn.effectiveType}`,
      conn.downlink != null && `downlink: ${conn.downlink} Mbps`,
      conn.rtt != null && `RTT hint: ${conn.rtt} ms`,
    ].filter(Boolean)
    set('connection-quality', {
      id: 'connection-quality',
      status: conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g' ? 'warn' : 'pass',
      detail: parts.join(' · ') || 'Connection metadata available',
      suggestion:
        conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g'
          ? 'Link looks very slow; move closer to Wi‑Fi or check data cap.'
          : undefined,
    })
  } else {
    set('connection-quality', {
      id: 'connection-quality',
      status: 'skip',
      detail: 'Network Information API not supported in this browser',
    })
  }

  // DNS
  markRunning('dns')
  const dnsStart = performance.now()
  let dnsOk = false
  let dnsError: string | undefined
  try {
    const res = await fetch('https://cloudflare-dns.com/dns-query?name=example.com&type=A', {
      headers: { Accept: 'application/dns-json' },
      cache: 'no-store',
    })
    const json = (await res.json()) as { Status?: number; Answer?: unknown[] }
    dnsOk = res.ok && json.Status === 0 && Array.isArray(json.Answer) && json.Answer.length > 0
    if (!dnsOk) dnsError = `DNS status ${json.Status ?? res.status}`
  } catch (e) {
    dnsError = e instanceof Error ? e.message : 'DNS query failed'
  }
  const dnsLatency = Math.round(performance.now() - dnsStart)
  set('dns', {
    id: 'dns',
    status: dnsOk ? 'pass' : 'fail',
    latencyMs: dnsLatency,
    detail: dnsOk
      ? `Resolved example.com (${dnsLatency} ms)`
      : dnsError ?? `DNS query failed (${dnsLatency} ms)`,
    suggestion: dnsOk
      ? undefined
      : 'Try another DNS (e.g. 1.1.1.1 or 8.8.8.8) in system settings, or reboot your router.',
  })

  // TCP / direct IP
  markRunning('tcp-ip')
  const ipReach = await timedFetch('https://1.1.1.1/cdn-cgi/trace')
  set('tcp-ip', {
    id: 'tcp-ip',
    status: ipReach.ok ? 'pass' : 'fail',
    latencyMs: ipReach.latencyMs,
    detail: ipReach.ok
      ? `Reached 1.1.1.1 over HTTPS (${ipReach.latencyMs} ms)`
      : ipReach.error ?? `Could not reach 1.1.1.1 (${ipReach.latencyMs} ms)`,
    suggestion: ipReach.ok
      ? undefined
      : 'If DNS works but this fails, routing or firewall may be blocking outbound traffic.',
  })

  // Internet — multiple endpoints
  markRunning('internet')
  const endpoints = [
    { name: 'Google', url: 'https://www.google.com/generate_204' },
    { name: 'Cloudflare', url: 'https://cloudflare.com/cdn-cgi/trace' },
  ]
  const internetResults = await Promise.all(
    endpoints.map(async (ep) => {
      const r = await timedFetch(ep.url)
      return { ...ep, ...r }
    }),
  )
  const passed = internetResults.filter((r) => r.ok)
  const internetOk = passed.length > 0
  set('internet', {
    id: 'internet',
    status: internetOk ? (passed.length === endpoints.length ? 'pass' : 'warn') : 'fail',
    latencyMs: passed[0]?.latencyMs,
    detail: internetOk
      ? `${passed.length}/${endpoints.length} endpoints reachable (${passed.map((p) => p.name).join(', ')})`
      : 'No public endpoints responded',
    suggestion: internetOk
      ? passed.length < endpoints.length
        ? 'Partial reachability — some sites or regions may be filtered.'
        : undefined
      : 'Check router WAN light, ISP outage, or captive portal (open http://neverssl.com in a new tab).',
  })

  // TLS
  markRunning('tls')
  const tls = await timedFetch('https://www.cloudflare.com')
  set('tls', {
    id: 'tls',
    status: tls.ok ? 'pass' : 'fail',
    latencyMs: tls.latencyMs,
    detail: tls.ok
      ? `TLS to cloudflare.com OK (${tls.latencyMs} ms)`
      : tls.error ?? `TLS/HTTPS failed (${tls.latencyMs} ms)`,
    suggestion: tls.ok ? undefined : 'System date/time wrong, corporate SSL inspection, or blocked HTTPS.',
  })

  // Latency — median of 3 samples
  markRunning('latency')
  const samples: number[] = []
  for (let i = 0; i < 3; i++) {
    const s = await timedFetch('https://cloudflare.com/cdn-cgi/trace')
    if (s.ok) samples.push(s.latencyMs)
  }
  samples.sort((a, b) => a - b)
  const median = samples.length ? samples[Math.floor(samples.length / 2)] : undefined
  let latencyStatus: TestStatus = 'fail'
  if (median != null) {
    if (median < 120) latencyStatus = 'pass'
    else if (median < 350) latencyStatus = 'warn'
    else latencyStatus = 'warn'
  }
  set('latency', {
    id: 'latency',
    status: samples.length ? latencyStatus : 'fail',
    latencyMs: median,
    detail:
      median != null
        ? `Median RTT ${median} ms (${samples.length} samples)`
        : 'Could not measure latency',
    suggestion:
      median != null && median >= 350
        ? 'High latency — Wi‑Fi congestion, VPN, or distant server; try wired connection.'
        : undefined,
  })

  // Gateway inference (layer 2)
  markRunning('local-gateway')
  const dnsFailed = results.get('dns')?.status === 'fail'
  const ipOk = results.get('tcp-ip')?.status === 'pass'
  const internetFailed = results.get('internet')?.status === 'fail'
  if (dnsFailed && !ipOk) {
    set('local-gateway', {
      id: 'local-gateway',
      status: 'info',
      detail: 'Cannot isolate LAN — DNS and IP checks both failed',
      suggestion: NETWORK_TESTS.find((t) => t.id === 'local-gateway')?.browserLimitation,
    })
  } else if (internetFailed && (dnsOk || ipOk)) {
    set('local-gateway', {
      id: 'local-gateway',
      status: 'warn',
      detail: 'Lower layers partly work but internet endpoints failed — possible router, ISP, or captive portal',
      suggestion: 'Reboot router, check WAN cable, or sign in to hotel/cafe Wi‑Fi portal.',
    })
  } else if (internetOk) {
    set('local-gateway', {
      id: 'local-gateway',
      status: 'pass',
      detail: 'Internet path appears healthy (LAN/gateway likely OK)',
    })
  } else {
    set('local-gateway', {
      id: 'local-gateway',
      status: 'info',
      detail: 'LAN/gateway not directly testable from the browser',
      suggestion: NETWORK_TESTS.find((t) => t.id === 'local-gateway')?.browserLimitation,
    })
  }

  return results
}

export function diagnoseWeakestLayer(results: Map<string, TestResult>): {
  headline: string
  layer: number
  layerName: string
} {
  const order = [
    'browser-online',
    'connection-quality',
    'local-gateway',
    'dns',
    'tcp-ip',
    'internet',
    'tls',
    'latency',
  ]

  for (const id of order) {
    const r = results.get(id)
    if (!r || r.status === 'running' || r.status === 'idle' || r.status === 'skip') continue
    if (r.status === 'fail') {
      const test = NETWORK_TESTS.find((t) => t.id === id)!
      return {
        headline: `Issue likely at: ${test.layerName} — ${test.title}`,
        layer: test.layer,
        layerName: test.layerName,
      }
    }
  }

  for (const id of order) {
    const r = results.get(id)
    if (r?.status === 'warn') {
      const test = NETWORK_TESTS.find((t) => t.id === id)!
      return {
        headline: `Degraded: ${test.layerName} — ${test.title}`,
        layer: test.layer,
        layerName: test.layerName,
      }
    }
  }

  return {
    headline: 'Network looks healthy from this browser',
    layer: 7,
    layerName: 'Performance',
  }
}
