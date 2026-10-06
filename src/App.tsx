import { useCallback, useEffect, useMemo, useState } from 'react'
import './App.css'
import {
  NETWORK_TESTS,
  type TestResult,
  type TestStatus,
  diagnoseWeakestLayer,
  runAllTests,
} from './lib/networkTests'

const STATUS_LABEL: Record<TestStatus, string> = {
  idle: 'Waiting',
  running: 'Running',
  pass: 'OK',
  fail: 'Failed',
  warn: 'Degraded',
  skip: 'N/A',
  info: 'Info',
}

function emptyResults(): Map<string, TestResult> {
  const m = new Map<string, TestResult>()
  for (const t of NETWORK_TESTS) {
    m.set(t.id, { id: t.id, status: 'idle', detail: 'Not run yet' })
  }
  return m
}

function App() {
  const [results, setResults] = useState<Map<string, TestResult>>(emptyResults)
  const [scanning, setScanning] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [lastRun, setLastRun] = useState<Date | null>(null)

  const runScan = useCallback(async () => {
    setScanning(true)
    setResults((prev) => {
      const next = new Map(prev)
      for (const t of NETWORK_TESTS) {
        next.set(t.id, { id: t.id, status: 'idle', detail: 'Queued…' })
      }
      return next
    })

    const final = await runAllTests({
      onProgress: (id, partial) => {
        setResults((prev) => {
          const next = new Map(prev)
          const existing = next.get(id) ?? { id, status: 'idle' as TestStatus, detail: '' }
          next.set(id, { ...existing, ...partial, id })
          return next
        })
      },
    })

    setResults(final)
    setLastRun(new Date())
    setScanning(false)
  }, [])

  useEffect(() => {
    const id = window.setTimeout(() => {
      void runScan()
    }, 0)
    return () => window.clearTimeout(id)
  }, [runScan])

  useEffect(() => {
    if (!autoRefresh) return
    const id = window.setInterval(() => {
      if (!scanning) void runScan()
    }, 60_000)
    return () => clearInterval(id)
  }, [autoRefresh, scanning, runScan])

  useEffect(() => {
    const onOnline = () => {
      if (!scanning) void runScan()
    }
    const onOffline = () => {
      setResults((prev) => {
        const next = new Map(prev)
        next.set('browser-online', {
          id: 'browser-online',
          status: 'fail',
          detail: 'Network went offline (browser event)',
          suggestion: 'Reconnect to Wi‑Fi or Ethernet.',
        })
        return next
      })
    }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [runScan, scanning])

  const diagnosis = useMemo(() => diagnoseWeakestLayer(results), [results])

  const summaryClass = useMemo(() => {
    const values = [...results.values()]
    if (values.some((r) => r.status === 'fail')) return 'issue'
    if (values.some((r) => r.status === 'warn')) return 'degraded'
    if (values.every((r) => r.status === 'idle' || r.status === 'running')) return ''
    return 'healthy'
  }, [results])

  const byLayer = useMemo(() => {
    const layers = new Map<number, typeof NETWORK_TESTS>()
    for (const t of NETWORK_TESTS) {
      const list = layers.get(t.layer) ?? []
      list.push(t)
      layers.set(t.layer, list)
    }
    return [...layers.entries()].sort(([a], [b]) => a - b)
  }, [])

  return (
    <div className="app">
      <header className="hero">
        <h1>Network Monitor</h1>
        <p>
          Runs from your browser on this device — no install. Checks each layer from device connectivity
          through DNS, routing, internet reachability, TLS, and latency so you can see where a problem
          likely starts.
        </p>
        <div className="actions">
          <button type="button" className="primary" disabled={scanning} onClick={() => void runScan()}>
            {scanning ? 'Scanning…' : 'Run full scan'}
          </button>
          <label className="auto">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            Re-scan every 60s
          </label>
        </div>
      </header>

      <section className={`summary-card ${summaryClass}`}>
        <p className="summary-headline">{scanning ? 'Scan in progress…' : diagnosis.headline}</p>
        <p className="summary-meta">
          {lastRun ? `Last scan: ${lastRun.toLocaleString()}` : '—'}
          {' · '}
          Layer focus: {diagnosis.layerName} (L{diagnosis.layer})
        </p>
      </section>

      <div className="pipeline">
        {byLayer.map(([layerNum, tests]) =>
          tests.map((test) => {
            const result = results.get(test.id) ?? {
              id: test.id,
              status: 'idle' as TestStatus,
              detail: '',
            }
            const status = result.status
            return (
              <div key={test.id} className="layer-row">
                <div className="layer-badge">L{layerNum}</div>
                <article className={`test-card status-${status}`}>
                  <div className="test-header">
                    <div>
                      <h2 className="test-title">{test.title}</h2>
                      <p className="test-desc">{test.description}</p>
                    </div>
                    <span className={`status-pill ${status}`}>{STATUS_LABEL[status]}</span>
                  </div>
                  <p className="test-detail">
                    {result.detail}
                    {result.latencyMs != null && status !== 'idle' ? ` · ${result.latencyMs} ms` : ''}
                  </p>
                  {result.suggestion ? (
                    <p className="test-suggestion">{result.suggestion}</p>
                  ) : null}
                </article>
              </div>
            )
          }),
        )}
      </div>

      <footer className="footer-note">
        <strong>Browser limits:</strong> This tool cannot ICMP-ping your router or run traceroute. Those
        checks require a native app or terminal. Results reflect <em>this browser&apos;s</em> path to the
        internet — VPNs, extensions, and corporate proxies can change outcomes. Host the built files
        statically (e.g. Vercel, Netlify, or <code>npm run dev</code>) and open the URL on any machine
        to test that machine&apos;s network.
      </footer>
    </div>
  )
}

export default App
