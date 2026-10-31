import { useMemo, useState } from "react";
import {
  Activity,
  CircuitBoard,
  Cpu,
  Gauge,
  Lightbulb,
  Radio,
  Sigma,
  Triangle,
  Waves,
} from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/Card";
import { Tabs } from "../components/ui/Tabs";
import { Badge } from "../components/ui/Badge";
import { cn } from "../lib/utils";

interface Point { x: number; y: number }

function Plot({ points, xDomain, yDomain, markers = [], height = 230, xLabel, yLabel, secondary = [] }: {
  points: Point[];
  xDomain: [number, number];
  yDomain: [number, number];
  markers?: { x: number; y: number; color: string; label?: string }[];
  height?: number;
  xLabel?: string;
  yLabel?: string;
  secondary?: Point[];
}) {
  const width = 540;
  const pad = 34;
  const innerWidth = width - pad * 2;
  const innerHeight = height - pad * 2;
  const [x0, x1] = xDomain;
  const [y0, y1] = yDomain;
  const px = (value: number) => pad + ((value - x0) / (x1 - x0 || 1)) * innerWidth;
  const py = (value: number) => pad + innerHeight - ((value - y0) / (y1 - y0 || 1)) * innerHeight;
  const path = (list: Point[]) => list.map((point, index) => `${index === 0 ? "M" : "L"} ${px(point.x).toFixed(1)} ${py(point.y).toFixed(1)}`).join(" ");
  const ticksX = [0, 0.25, 0.5, 0.75, 1].map((ratio) => x0 + (x1 - x0) * ratio);
  const ticksY = [0, 0.25, 0.5, 0.75, 1].map((ratio) => y0 + (y1 - y0) * ratio);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Interactive simulation plot">
      {ticksX.map((tick) => <line key={`gx-${tick}`} x1={px(tick)} x2={px(tick)} y1={pad} y2={pad + innerHeight} stroke="hsl(var(--border))" strokeDasharray="3 4" opacity="0.5" />)}
      {ticksY.map((tick) => <line key={`gy-${tick}`} x1={pad} x2={pad + innerWidth} y1={py(tick)} y2={py(tick)} stroke="hsl(var(--border))" strokeDasharray="3 4" opacity="0.5" />)}
      <line x1={pad} x2={pad + innerWidth} y1={pad + innerHeight} y2={pad + innerHeight} stroke="hsl(var(--border))" />
      <line x1={pad} x2={pad} y1={pad} y2={pad + innerHeight} stroke="hsl(var(--border))" />
      {ticksX.map((tick) => <text key={`tx-${tick}`} x={px(tick)} y={height - 12} textAnchor="middle" fontSize="8" fill="hsl(var(--muted-foreground))">{tick.toFixed(Math.abs(x1 - x0) < 10 ? 1 : 0)}</text>)}
      {ticksY.map((tick) => <text key={`ty-${tick}`} x={pad - 6} y={py(tick) + 3} textAnchor="end" fontSize="8" fill="hsl(var(--muted-foreground))">{tick.toFixed(Math.abs(y1 - y0) < 10 ? 1 : 0)}</text>)}
      {secondary.length > 1 ? <path d={path(secondary)} fill="none" stroke="hsl(var(--warning))" strokeWidth="1.3" strokeDasharray="5 4" opacity="0.8" /> : null}
      {points.length > 1 ? <path d={path(points)} fill="none" stroke="hsl(var(--primary))" strokeWidth="2" /> : null}
      {markers.map((marker, index) => (
        <g key={index}>
          <circle cx={px(marker.x)} cy={py(marker.y)} r="4" fill={marker.color} stroke="hsl(var(--card))" strokeWidth="1.5" />
          {marker.label ? <text x={px(marker.x) + 6} y={py(marker.y) - 6} fontSize="8" fill={marker.color}>{marker.label}</text> : null}
        </g>
      ))}
      {xLabel ? <text x={pad + innerWidth - 4} y={height - 12} textAnchor="end" fontSize="8" fill="hsl(var(--muted-foreground))">{xLabel}</text> : null}
      {yLabel ? <text x={pad + 4} y={pad - 10} fontSize="8" fill="hsl(var(--muted-foreground))">{yLabel}</text> : null}
    </svg>
  );
}

function Slider({ label, value, min, max, step, unit, onChange }: { label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (value: number) => void }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px]"><span className="text-muted-foreground">{label}</span><span className="font-mono font-medium">{value} {unit}</span></div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} className="slider w-full" />
    </div>
  );
}

function SamplingLab() {
  const [frequency, setFrequency] = useState(4);
  const [sampleRate, setSampleRate] = useState(30);
  const duration = 1;
  const continuous = useMemo(() => Array.from({ length: 500 }, (_, index) => {
    const t = (index / 499) * duration;
    return { x: t, y: Math.sin(2 * Math.PI * frequency * t) };
  }), [frequency]);
  const samples = useMemo(() => Array.from({ length: Math.floor(sampleRate * duration) + 1 }, (_, index) => {
    const t = index / sampleRate;
    return { x: t, y: Math.sin(2 * Math.PI * frequency * t) };
  }), [sampleRate, frequency]);
  const aliased = sampleRate < 2 * frequency;
  const aliasFrequency = Math.abs(frequency - Math.round(frequency / sampleRate) * sampleRate);

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader className="flex-row items-center justify-between"><CardTitle>Sampling & aliasing</CardTitle><Badge className={aliased ? "border-danger/30 text-danger" : "border-success/30 text-success"}>{aliased ? "Aliasing" : "Nyquist satisfied"}</Badge></CardHeader>
        <CardContent>
          <Plot points={continuous} markers={samples.map((point) => ({ ...point, color: "hsl(var(--accent))" }))} xDomain={[0, duration]} yDomain={[-1.3, 1.3]} xLabel="time (s)" yLabel="amplitude" />
          <p className="mt-2 text-center text-[10px] text-muted-foreground">Solid line: continuous signal. Dots: sampled values at {sampleRate} Hz.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Controls</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Slider label="Signal frequency" value={frequency} min={1} max={20} step={1} unit="Hz" onChange={setFrequency} />
          <Slider label="Sampling rate" value={sampleRate} min={2} max={80} step={1} unit="Hz" onChange={setSampleRate} />
          <div className={cn("rounded-xl border p-3 text-[11px] leading-5", aliased ? "border-danger/25 bg-danger/5 text-danger" : "border-success/20 bg-success/5 text-success")}>
            Nyquist rate = {2 * frequency} Hz. {aliased ? `Under-sampled: the ${frequency} Hz tone folds to ${aliasFrequency.toFixed(1)} Hz.` : "Sampling is fast enough to reconstruct the tone."}
          </div>
          <p className="text-[10px] leading-4 text-muted-foreground">Try 4 Hz sampled at 6 Hz: the reconstructed wave looks like a 2 Hz tone. This is the folded alias frequency.</p>
        </CardContent>
      </Card>
    </div>
  );
}

function RcLab() {
  const [resistance, setResistance] = useState(10);
  const [capacitance, setCapacitance] = useState(10);
  const tau = resistance * 1000 * capacitance * 1e-6;
  const maxTime = Math.max(0.001, tau * 6);
  const curve = useMemo(() => Array.from({ length: 300 }, (_, index) => {
    const t = (index / 299) * maxTime;
    return { x: t, y: 1 - Math.exp(-t / tau) };
  }), [maxTime, tau]);
  const marks = [1, 2, 3, 4, 5].map((multiple) => ({ x: multiple * tau, y: 1 - Math.exp(-multiple), color: "hsl(var(--accent))", label: `${multiple}τ ${(100 * (1 - Math.exp(-multiple))).toFixed(1)}%` }));

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader><CardTitle>RC step response</CardTitle></CardHeader>
        <CardContent>
          <Plot points={curve} markers={marks} xDomain={[0, maxTime * 1000]} yDomain={[0, 1.05]} xLabel="time (ms)" yLabel="Vc / Vs" />
          <p className="mt-2 text-center text-[10px] text-muted-foreground">Capacitor voltage as a fraction of the step amplitude. Time constant τ = RC.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Controls</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Slider label="Resistance" value={resistance} min={1} max={100} step={1} unit="kΩ" onChange={setResistance} />
          <Slider label="Capacitance" value={capacitance} min={1} max={100} step={1} unit="µF" onChange={setCapacitance} />
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-[11px] leading-5 text-muted-foreground">
            τ = <span className="font-mono text-foreground">{(tau * 1000).toFixed(1)} ms</span><br />
            v(t) = Vs(1 − e<sup>−t/τ</sup>)<br />
            99% settled at ≈ 4.6τ = {(4.6 * tau * 1000).toFixed(1)} ms
          </div>
          <p className="text-[10px] leading-4 text-muted-foreground">After 1τ the capacitor reaches 63.2%, after 5τ 99.3%. Larger R or C slows charging.</p>
        </CardContent>
      </Card>
    </div>
  );
}

function RlcLab() {
  const [resistance, setResistance] = useState(20);
  const [inductance, setInductance] = useState(10);
  const [capacitance, setCapacitance] = useState(10);
  const L = inductance * 1e-3;
  const C = capacitance * 1e-6;
  const f0 = 1 / (2 * Math.PI * Math.sqrt(L * C));
  const q = (1 / resistance) * Math.sqrt(L / C);
  const bw = f0 / q;
  const curve = useMemo(() => Array.from({ length: 400 }, (_, index) => {
    const f = f0 * Math.pow(10, -1 + (index / 399) * 2);
    const ratio = f / f0;
    const magnitude = 1 / Math.sqrt(Math.pow(1 - ratio * ratio, 2) + Math.pow(ratio / q, 2));
    return { x: f, y: Math.min(1, magnitude / q) };
  }), [f0, q]);
  const peak = { x: f0, y: 1, color: "hsl(var(--accent))", label: "f₀" };

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader className="flex-row items-center justify-between"><CardTitle>Series RLC resonance</CardTitle><Badge>Q = {q.toFixed(1)}</Badge></CardHeader>
        <CardContent>
          <Plot points={curve} markers={[peak]} xDomain={[f0 / 10, f0 * 10]} yDomain={[0, 1.08]} xLabel="frequency (Hz, log scale)" yLabel="normalised current" />
          <p className="mt-2 text-center text-[10px] text-muted-foreground">Current peaks at resonance. Higher Q means a sharper, narrower band.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Controls</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Slider label="Resistance" value={resistance} min={5} max={200} step={5} unit="Ω" onChange={setResistance} />
          <Slider label="Inductance" value={inductance} min={1} max={100} step={1} unit="mH" onChange={setInductance} />
          <Slider label="Capacitance" value={capacitance} min={1} max={100} step={1} unit="µF" onChange={setCapacitance} />
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-[11px] leading-5 text-muted-foreground">
            f₀ = <span className="font-mono text-foreground">{f0.toFixed(1)} Hz</span><br />
            Q = {q.toFixed(1)} · BW = <span className="font-mono text-foreground">{bw.toFixed(1)} Hz</span><br />
            Z₀ = R = {resistance} Ω
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function DiodeLab() {
  const [supply, setSupply] = useState(5);
  const [resistance, setResistance] = useState(1000);
  const [ideality, setIdeality] = useState(1.8);
  const thermal = 0.02585;
  const saturation = 1e-12;

  const operatingPoint = useMemo(() => {
    const currentAt = (voltage: number) => saturation * (Math.exp(voltage / (ideality * thermal)) - 1);
    let low = 0;
    let high = 0.95;
    for (let i = 0; i < 100; i += 1) {
      const mid = (low + high) / 2;
      const current = currentAt(mid);
      if ((supply - mid) / resistance > current) low = mid;
      else high = mid;
    }
    const voltage = (low + high) / 2;
    return { voltage, current: currentAt(voltage) };
  }, [supply, resistance, ideality]);

  const diodeCurve = useMemo(() => Array.from({ length: 260 }, (_, index) => {
    const voltage = (index / 259) * 0.85;
    const current = saturation * (Math.exp(voltage / (ideality * thermal)) - 1);
    return { x: voltage, y: Math.min(current * 1000, 25) };
  }), [ideality]);

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader className="flex-row items-center justify-between"><CardTitle>Diode DC operating point</CardTitle><Badge>Q-point</Badge></CardHeader>
        <CardContent>
          <Plot points={diodeCurve} markers={[{ x: operatingPoint.voltage, y: Math.min(operatingPoint.current * 1000, 25), color: "hsl(var(--accent))", label: "Q" }]} xDomain={[0, 0.85]} yDomain={[0, 25]} xLabel="diode voltage (V)" yLabel="current (mA)" />
          <p className="mt-2 text-center text-[10px] text-muted-foreground">Shockley diode characteristic; the marker shows the intersection with the resistive load line.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Controls</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Slider label="Supply voltage" value={supply} min={1} max={12} step={0.5} unit="V" onChange={setSupply} />
          <Slider label="Series resistance" value={resistance} min={100} max={5000} step={100} unit="Ω" onChange={setResistance} />
          <Slider label="Ideality factor n" value={ideality} min={1} max={2.5} step={0.1} unit="" onChange={setIdeality} />
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-[11px] leading-5 text-muted-foreground">
            V<sub>D</sub> ≈ <span className="font-mono text-foreground">{operatingPoint.voltage.toFixed(3)} V</span><br />
            I<sub>D</sub> ≈ <span className="font-mono text-foreground">{(operatingPoint.current * 1000).toFixed(2)} mA</span><br />
            V<sub>R</sub> = {supply} − V<sub>D</sub> ≈ {(supply - operatingPoint.voltage).toFixed(2)} V
          </div>
          <p className="text-[10px] leading-4 text-muted-foreground">Model uses Is = 1 pA, Vt = 25.85 mV. Real diodes include series resistance and breakdown.</p>
        </CardContent>
      </Card>
    </div>
  );
}

const gateFns: Record<string, (a: boolean, b: boolean) => boolean> = {
  AND: (a, b) => a && b,
  OR: (a, b) => a || b,
  XOR: (a, b) => a !== b,
  NAND: (a, b) => !(a && b),
  NOR: (a, b) => !(a || b),
  XNOR: (a, b) => a === b,
};

function LogicLab() {
  const [gate, setGate] = useState("XOR");
  const [a, setA] = useState(false);
  const [b, setB] = useState(false);
  const output = gateFns[gate](a, b);

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader><CardTitle>Logic gate simulator</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-col items-center gap-5 py-4">
            <div className="flex items-center gap-6">
              <div className="space-y-2">
                {[
                  { label: "A", value: a, toggle: () => setA(!a) },
                  { label: "B", value: b, toggle: () => setB(!b) },
                ].map((input) => (
                  <button key={input.label} onClick={input.toggle} className={cn("flex h-11 w-20 items-center justify-between rounded-xl border px-3 text-xs font-semibold transition", input.value ? "border-primary/50 bg-primary/[0.15] text-primary" : "border-border bg-muted/30 text-muted-foreground")}>
                    <span>{input.label}</span><span className={cn("h-2.5 w-2.5 rounded-full", input.value ? "bg-primary glow-primary" : "bg-muted-foreground/30")} />
                  </button>
                ))}
              </div>
              <div className="flex flex-col items-center gap-1 text-muted-foreground">
                <svg width="90" height="70" viewBox="0 0 90 70"><path d="M8 18 H28 M8 52 H28" stroke="currentColor" strokeWidth="2" /><path d="M28 8 L58 35 L28 62 Z" fill="none" stroke="currentColor" strokeWidth="2" /><circle cx="62" cy="35" r="3" fill="currentColor" /><path d="M65 35 H82" stroke="currentColor" strokeWidth="2" /></svg>
                <select value={gate} onChange={(event) => setGate(event.target.value)} className="focus-ring rounded-lg border border-border bg-card px-2 py-1 text-xs">{Object.keys(gateFns).map((name) => <option key={name}>{name}</option>)}</select>
              </div>
              <div className={cn("flex h-14 w-20 flex-col items-center justify-center rounded-xl border text-xs font-bold transition", output ? "border-success/40 bg-success/[0.12] text-success" : "border-border bg-muted/30 text-muted-foreground")}>
                <span className={cn("mb-1 h-2.5 w-2.5 rounded-full", output ? "bg-success" : "bg-muted-foreground/30")} />Y = {output ? 1 : 0}
              </div>
            </div>
            <p className="text-center text-[11px] text-muted-foreground">Click inputs A and B. The truth table updates for the selected gate.</p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Truth table · {gate}</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-center text-xs">
              <thead className="bg-muted/40 text-[10px] uppercase text-muted-foreground"><tr><th className="px-2 py-2">A</th><th className="px-2 py-2">B</th><th className="px-2 py-2">Y</th></tr></thead>
              <tbody>
                {[false, true].flatMap((rowA) => [false, true].map((rowB) => (
                  <tr key={`${rowA}-${rowB}`} className={cn("border-t border-border/60", rowA === a && rowB === b && "bg-primary/[0.08]")}>
                    <td className="px-2 py-1.5">{Number(rowA)}</td><td className="px-2 py-1.5">{Number(rowB)}</td><td className={cn("px-2 py-1.5 font-semibold", gateFns[gate](rowA, rowB) ? "text-success" : "text-muted-foreground")}>{Number(gateFns[gate](rowA, rowB))}</td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[10px] leading-4 text-muted-foreground">Educational logic simulation. Propagation delay, fan-out and voltage levels are ignored.</p>
        </CardContent>
      </Card>
    </div>
  );
}

function CmosLab() {
  const [supply, setSupply] = useState(3.3);
  const [switching, setSwitching] = useState(0.45);
  const curve = useMemo(() => Array.from({ length: 240 }, (_, index) => {
    const vin = (index / 239) * supply;
    const normalised = vin / supply;
    const vout = supply * (0.5 - 0.5 * Math.tanh((normalised - switching) * 14));
    return { x: vin, y: vout };
  }), [supply, switching]);

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader className="flex-row items-center justify-between"><CardTitle>CMOS inverter VTC</CardTitle><Badge>Approximate model</Badge></CardHeader>
        <CardContent>
          <Plot points={curve} markers={[{ x: supply * switching, y: supply / 2, color: "hsl(var(--accent))", label: "Vm" }]} xDomain={[0, supply]} yDomain={[0, supply]} xLabel="Vin (V)" yLabel="Vout (V)" />
          <p className="mt-2 text-center text-[10px] text-muted-foreground">Illustrative transfer curve: both transistors conduct near the switching threshold, creating the steep transition.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Controls</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Slider label="Supply voltage" value={supply} min={1.8} max={5} step={0.1} unit="V" onChange={setSupply} />
          <Slider label="Switching threshold (fraction of VDD)" value={switching} min={0.25} max={0.65} step={0.01} unit="" onChange={setSwitching} />
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-[11px] leading-5 text-muted-foreground">
            V<sub>DD</sub> = {supply.toFixed(1)} V<br />
            V<sub>in</sub> threshold ≈ <span className="font-mono text-foreground">{(supply * switching).toFixed(2)} V</span><br />
            V<sub>OH</sub> ≈ {supply.toFixed(1)} V · V<sub>OL</sub> ≈ 0 V
          </div>
          <p className="text-[10px] leading-4 text-muted-foreground">Real CMOS switching threshold depends on β<sub>n</sub>/β<sub>p</sub> and transistor sizing. This smooth curve is for intuition, not sign-off simulation.</p>
        </CardContent>
      </Card>
    </div>
  );
}

function FftLab() {
  const [fundamental, setFundamental] = useState(3);
  const [third, setThird] = useState(0.35);
  const [fifth, setFifth] = useState(0.2);
  const [noise, setNoise] = useState(0.05);
  const samples = 512;

  const wave = useMemo(() => {
    let seed = 42;
    const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
    return Array.from({ length: samples }, (_, index) => {
      const t = index / samples;
      const value = Math.sin(2 * Math.PI * fundamental * t) + third * Math.sin(2 * Math.PI * 3 * fundamental * t) + fifth * Math.sin(2 * Math.PI * 5 * fundamental * t) + noise * random();
      return { x: index, y: value };
    });
  }, [fundamental, third, fifth, noise]);

  const spectrum = useMemo(() => {
    const bins = [1, 2, 3, 4, 5, 6, 7];
    return bins.map((harmonic) => {
      let real = 0;
      let imaginary = 0;
      wave.forEach((point, index) => {
        const angle = (2 * Math.PI * harmonic * index) / samples;
        real += point.y * Math.cos(angle);
        imaginary -= point.y * Math.sin(angle);
      });
      const amplitude = (2 * Math.sqrt(real * real + imaginary * imaginary)) / samples;
      return { harmonic, amplitude };
    });
  }, [wave]);
  const maxAmplitude = Math.max(1, ...spectrum.map((entry) => entry.amplitude));

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader className="flex-row items-center justify-between"><CardTitle>Harmonics & spectrum</CardTitle><Badge>{samples}-point DFT</Badge></CardHeader>
        <CardContent className="space-y-3">
          <Plot points={wave} xDomain={[0, samples]} yDomain={[-2, 2]} height={180} xLabel="sample index" yLabel="amplitude" />
          <div className="flex h-32 items-end gap-3 border-b border-border px-3 pb-1">
            {spectrum.map((entry) => (
              <div key={entry.harmonic} className="flex flex-1 flex-col items-center justify-end gap-1">
                <span className="text-[9px] text-muted-foreground">{entry.amplitude.toFixed(2)}</span>
                <div className="w-full rounded-t bg-gradient-to-t from-primary/50 to-primary transition-all" style={{ height: `${(entry.amplitude / maxAmplitude) * 90}%` }} />
                <span className="text-[9px] text-muted-foreground">{entry.harmonic}f₀</span>
              </div>
            ))}
          </div>
          <p className="text-center text-[10px] text-muted-foreground">Time-domain waveform (top) and single-sided DFT amplitude (bottom). Clear peaks appear at odd harmonics.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Controls</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Slider label="Fundamental frequency" value={fundamental} min={1} max={8} step={1} unit="f₀" onChange={setFundamental} />
          <Slider label="3rd harmonic" value={third} min={0} max={1} step={0.05} unit="×" onChange={setThird} />
          <Slider label="5th harmonic" value={fifth} min={0} max={1} step={0.05} unit="×" onChange={setFifth} />
          <Slider label="Noise" value={noise} min={0} max={0.3} step={0.01} unit="×" onChange={setNoise} />
          <p className="text-[10px] leading-4 text-muted-foreground">A square wave contains odd harmonics with amplitudes 1/n. Add the 3rd and 5th to see the waveform sharpen and spectral peaks rise.</p>
        </CardContent>
      </Card>
    </div>
  );
}

export default function Visuals() {
  const [tab, setTab] = useState("sampling");
  return (
    <div>
      <PageHeader title="Interactive Visual Lab" subtitle="Drag the controls to build intuition for sampling, time constants, resonance, diodes, logic and spectra." actions={<Badge><Lightbulb size={11} /> Live simulations</Badge>} />
      <Tabs
        value={tab}
        onChange={setTab}
        className="mb-4 overflow-x-auto"
        items={[
          { id: "sampling", label: "Sampling", icon: Waves },
          { id: "rc", label: "RC response", icon: Activity },
          { id: "rlc", label: "RLC resonance", icon: Radio },
          { id: "diode", label: "Diode Q-point", icon: Triangle },
          { id: "logic", label: "Logic gates", icon: CircuitBoard },
          { id: "cmos", label: "CMOS VTC", icon: Cpu },
          { id: "fft", label: "FFT spectrum", icon: Sigma },
        ]}
      />
      {tab === "sampling" ? <SamplingLab /> : null}
      {tab === "rc" ? <RcLab /> : null}
      {tab === "rlc" ? <RlcLab /> : null}
      {tab === "diode" ? <DiodeLab /> : null}
      {tab === "logic" ? <LogicLab /> : null}
      {tab === "cmos" ? <CmosLab /> : null}
      {tab === "fft" ? <FftLab /> : null}
      <div className="mt-5 flex items-start gap-2 rounded-xl border border-border bg-muted/20 p-3 text-[10px] leading-5 text-muted-foreground">
        <Gauge size={13} className="mt-0.5 shrink-0 text-primary" />
        These are educational models using idealised equations. They do not replace SPICE simulation or bench measurements. For full experiments with code and viva questions, open the Virtual Labs.
      </div>
    </div>
  );
}
