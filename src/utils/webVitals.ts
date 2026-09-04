export interface WebVitalsMetric {
  name: string;
  value: number;
  rating: 'good' | 'needs-improvement' | 'poor';
}

export class WebVitalsCollector {
  private metrics: WebVitalsMetric[] = [];

  constructor() {
    if (typeof window === 'undefined') return;
    this.init();
  }

  private init(): void {
    this.observeLCP();
    this.observeFID();
    this.observeCLS();
    this.observeFCP();
    this.observeTTFB();
  }

  private observeLCP(): void {
    const observer = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const lastEntry = entries[entries.length - 1] as PerformanceEntry & { element?: Element };
      if (lastEntry) {
        this.addMetric('LCP', lastEntry.startTime);
      }
    });
    observer.observe({ entryTypes: ['largest-contentful-paint'] });
  }

  private observeFID(): void {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const fidEntry = entry as PerformanceEventTiming;
        if (fidEntry.processingStart !== undefined) {
          this.addMetric('FID', fidEntry.processingStart - fidEntry.startTime);
        }
      }
    });
    observer.observe({ entryTypes: ['first-input'] });
  }

  private observeCLS(): void {
    let clsValue = 0;
    let clsEntries: PerformanceEntry[] = [];

    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const layoutShift = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
        if (!layoutShift.hadRecentInput) {
          clsValue += layoutShift.value || 0;
          clsEntries.push(entry);
        }
      }
    });

    observer.observe({ entryTypes: ['layout-shift'] });

    setTimeout(() => {
      this.addMetric('CLS', clsValue);
    }, 3000);
  }

  private observeFCP(): void {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name === 'first-contentful-paint') {
          this.addMetric('FCP', entry.startTime);
        }
      }
    });
    observer.observe({ entryTypes: ['paint'] });
  }

  private observeTTFB(): void {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const nav = entry as PerformanceNavigationTiming;
        if (nav.responseStart !== undefined) {
          this.addMetric('TTFB', nav.responseStart - nav.requestStart);
        }
      }
    });
    observer.observe({ entryTypes: ['navigation'] });
  }

  private addMetric(name: string, value: number): void {
    const rating = this.getRating(name, value);
    this.metrics.push({ name, value: Math.round(value), rating });
  }

  private getRating(name: string, value: number): 'good' | 'needs-improvement' | 'poor' {
    const thresholds: { [key: string]: { good: number; poor: number } } = {
      LCP: { good: 2500, poor: 4000 },
      FID: { good: 100, poor: 300 },
      CLS: { good: 0.1, poor: 0.25 },
      FCP: { good: 1800, poor: 3000 },
      TTFB: { good: 800, poor: 1800 },
    };

    const threshold = thresholds[name];
    if (!threshold) return 'needs-improvement';

    if (value <= threshold.good) return 'good';
    if (value <= threshold.poor) return 'needs-improvement';
    return 'poor';
  }

  public getMetrics(): WebVitalsMetric[] {
    return this.metrics;
  }
}

export const webVitalsCollector = new WebVitalsCollector();
