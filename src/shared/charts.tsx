import { useEffect, useRef, useState } from 'react';
import type { WifiNetwork } from './models';
function usePlotWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(650);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(Math.max(240, Math.round(w)));
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}
export function LineChart({
  series,
  height = 200,
  label = '检测曲线',
  unit = 'ms',
  domain,
}: {
  series: { values: (number | null)[]; color: string; name: string }[];
  height?: number;
  label?: string;
  unit?: string;
  domain?: [number, number];
}) {
  const { ref, width } = usePlotWidth();
  const left = 44,
    right = 18,
    top = 20,
    bottom = 30;
  const values = series.flatMap((s) =>
    s.values.filter((v): v is number => v !== null && Number.isFinite(v)),
  );
  const max = domain?.[1] ?? Math.max(1, ...values) * 1.15,
    min = domain?.[0] ?? 0;
  const length = Math.max(2, ...series.map((s) => s.values.length));
  const x = (i: number) => left + (i * (width - left - right)) / (length - 1),
    y = (v: number) => height - bottom - ((v - min) * (height - top - bottom)) / (max - min);
  return (
    <div ref={ref} className="line-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
        <title>{label}</title>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line
              x1={left}
              x2={width - right}
              y1={y(min + (max - min) * f)}
              y2={y(min + (max - min) * f)}
              className="grid-line"
            />
            <text
              x={left - 9}
              y={y(min + (max - min) * f) + 4}
              textAnchor="end"
              className="axis-label"
            >
              {(min + (max - min) * f).toFixed(domain || max > 100 ? 0 : 1)}
            </text>
          </g>
        ))}
        {series.map((s) => {
          let path = '';
          let open = false;
          s.values.forEach((v, i) => {
            if (v === null || !Number.isFinite(v)) {
              open = false;
              return;
            }
            path += `${open ? 'L' : 'M'}${x(i).toFixed(2)},${y(v).toFixed(2)} `;
            open = true;
          });
          return (
            <path
              key={s.name}
              d={path}
              fill="none"
              stroke={s.color}
              strokeWidth="2.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        })}
        <text x={left} y={height - 6} className="axis-label">
          较早
        </text>
        <text x={width - right} y={height - 6} textAnchor="end" className="axis-label">
          最新 · {unit}
        </text>
      </svg>
      <div className="chart-legend">
        {series.map((s) => (
          <span key={s.name}>
            <i style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
    </div>
  );
}
const colors = ['#a76a41', '#6788ac', '#8d76ad', '#a18a43', '#568c91', '#b47785'];
export function ChannelChart({
  networks,
  min,
  max,
  title,
}: {
  networks: WifiNetwork[];
  min: number;
  max: number;
  title: string;
}) {
  const { ref, width } = usePlotWidth();
  const height = 240,
    left = 45,
    right = 18,
    bottom = 35,
    top = 25;
  const x = (f: number) => left + ((f - min) / (max - min)) * (width - left - right),
    y = (rssi: number) =>
      height -
      bottom -
      ((Math.max(-100, Math.min(-20, rssi)) + 100) / 80) * (height - top - bottom);
  const selected = networks.filter((n) => {
    const c = n.centerFrequency ?? n.frequency,
      w = n.width ?? 20;
    return c + w / 2 >= min && c - w / 2 <= max;
  });
  const firstTick = min > 5700 ? 5745 : min > 5400 ? 5500 : 5180;
  const ticks =
    min < 2500
      ? [2412, 2437, 2462, 2472]
      : Array.from(
          { length: Math.floor((max - firstTick) / 20) + 1 },
          (_, i) => firstTick + i * 20,
        );
  return (
    <div ref={ref} className="channel-panel">
      <div className="chart-heading">
        <span>{title}</span>
        <small>信号强度 · dBm</small>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title} 信道与带宽重叠示意`}>
        <defs>
          <clipPath id={`clip-${min}`}>
            <rect
              x={left}
              y={top - 8}
              width={width - left - right}
              height={height - top - bottom + 10}
            />
          </clipPath>
        </defs>
        {[-100, -80, -60, -40, -20].map((db) => (
          <g key={db}>
            <line x1={left} x2={width - right} y1={y(db)} y2={y(db)} className="grid-line" />
            <text x={left - 10} y={y(db) + 4} textAnchor="end" className="axis-label">
              {db}
            </text>
          </g>
        ))}
        {ticks.map((f) => (
          <g key={f}>
            <line
              x1={x(f)}
              x2={x(f)}
              y1={top}
              y2={height - bottom}
              className="grid-line vertical"
            />
            <text x={x(f)} y={height - 13} textAnchor="middle" className="axis-label">
              {Math.round(f < 2500 ? (f - 2407) / 5 : (f - 5000) / 5)}
            </text>
          </g>
        ))}
        <g clipPath={`url(#clip-${min})`}>
          {[...selected]
            .sort((a, b) => Number(a.connected) - Number(b.connected))
            .map((n, i) => {
              const center = n.centerFrequency ?? n.frequency,
                w = n.width ?? 20,
                x1 = x(center - w / 2),
                x2 = x(center + w / 2),
                xm = x(center),
                cy = y(n.rssi),
                base = y(-100),
                shoulder = (x2 - x1) * 0.16,
                color = n.connected ? 'var(--accent)' : colors[i % colors.length];
              return (
                <g key={n.bssid}>
                  <path
                    d={
                      n.width === null
                        ? `M ${x(n.frequency)} ${base} L ${x(n.frequency)} ${cy}`
                        : `M ${x1} ${base} Q ${x1 + shoulder * 0.4} ${cy} ${x1 + shoulder} ${cy} L ${x2 - shoulder} ${cy} Q ${x2 - shoulder * 0.4} ${cy} ${x2} ${base} Z`
                    }
                    fill={n.width === null ? 'none' : color}
                    fillOpacity={n.connected ? 0.16 : 0.07}
                    stroke={color}
                    strokeWidth={n.connected ? 2.4 : 1.2}
                    strokeDasharray={n.width === null ? '5 4' : undefined}
                  >
                    <title>
                      {n.ssid || '隐藏网络'} · 信道 {n.channel} · {n.width ?? '未知'} MHz · {n.rssi}{' '}
                      dBm{n.connected ? ' · 当前连接' : ''}
                    </title>
                  </path>
                  {(n.connected ||
                    (n.rssi > -64 &&
                      n.ssid.length > 0 &&
                      n.ssid !== networks.find((ap) => ap.connected)?.ssid)) && (
                    <text
                      x={xm}
                      y={cy - 8}
                      textAnchor="middle"
                      className={`network-label ${n.connected ? 'current' : ''}`}
                    >
                      {n.ssid || '隐藏网络'}
                    </text>
                  )}
                </g>
              );
            })}
        </g>
      </svg>
      <div className="chart-legend">
        <span>
          <i style={{ background: 'var(--accent)' }} />
          当前连接
        </span>
        <span>
          <i style={{ background: '#8e9d96' }} />
          附近接入点
        </span>
        <span className="legend-note">频宽示意，非频谱仪测量</span>
      </div>
    </div>
  );
}
