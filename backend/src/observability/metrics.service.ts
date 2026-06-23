import { Injectable } from '@nestjs/common';

interface MetricSeries {
  help: string;
  type: 'counter' | 'gauge';
  values: Map<string, number>; // label-string -> value
}

/**
 * Minimal in-memory metrics registry rendering Prometheus exposition format.
 * Counters are fed by the logging interceptor and domain services; gauges are
 * filled on scrape. Good enough for a single instance; swap for prom-client +
 * a shared store when you scale horizontally.
 */
@Injectable()
export class MetricsService {
  private readonly series = new Map<string, MetricSeries>();

  private ensure(
    name: string,
    type: MetricSeries['type'],
    help: string,
  ): MetricSeries {
    let s = this.series.get(name);
    if (!s) {
      s = { help, type, values: new Map() };
      this.series.set(name, s);
    }
    return s;
  }

  inc(name: string, labels: Record<string, string> = {}, by = 1): void {
    const s = this.ensure(name, 'counter', name);
    const key = this.labelKey(labels);
    s.values.set(key, (s.values.get(key) ?? 0) + by);
  }

  setGauge(name: string, value: number, labels: Record<string, string> = {}): void {
    const s = this.ensure(name, 'gauge', name);
    s.values.set(this.labelKey(labels), value);
  }

  render(): string {
    const lines: string[] = [];
    for (const [name, s] of this.series) {
      lines.push(`# HELP ${name} ${s.help}`);
      lines.push(`# TYPE ${name} ${s.type}`);
      for (const [labelStr, value] of s.values) {
        lines.push(`${name}${labelStr} ${value}`);
      }
    }
    return lines.join('\n') + '\n';
  }

  private labelKey(labels: Record<string, string>): string {
    const keys = Object.keys(labels).sort();
    if (!keys.length) return '';
    return `{${keys.map((k) => `${k}="${labels[k]}"`).join(',')}}`;
  }
}
