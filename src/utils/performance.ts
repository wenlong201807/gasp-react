export class PerformanceMonitor {
  private metrics: {
    paint: { [key: string]: number };
    navigation: { [key: string]: number };
    resource: number[];
  };

  constructor() {
    this.metrics = {
      paint: {},
      navigation: {},
      resource: [],
    };
    this.init();
  }

  private init(): void {
    if (typeof window === 'undefined') return;

    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.entryType === 'paint') {
          this.metrics.paint[entry.name] = entry.startTime;
        } else if (entry.entryType === 'navigation') {
          const nav = entry as PerformanceNavigationTiming;
          this.metrics.navigation = {
            domContentLoaded: nav.domContentLoadedEventEnd - nav.domContentLoadedEventStart,
            load: nav.loadEventEnd - nav.startTime,
            domInteractive: nav.domInteractive - nav.startTime,
          };
        }
      }
    });

    observer.observe({ entryTypes: ['paint', 'navigation'] });

    const resourceObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.entryType === 'resource') {
          const resource = entry as PerformanceResourceTiming;
          this.metrics.resource.push(resource.responseEnd - resource.startTime);
        }
      }
    });

    resourceObserver.observe({ entryTypes: ['resource'] });
  }

  public getMetrics(): {
    paint: { [key: string]: number };
    navigation: { [key: string]: number };
    avgResourceTime: number;
  } {
    const avgResourceTime =
      this.metrics.resource.length > 0
        ? this.metrics.resource.reduce((a, b) => a + b, 0) / this.metrics.resource.length
        : 0;

    return {
      paint: this.metrics.paint,
      navigation: this.metrics.navigation,
      avgResourceTime: Math.round(avgResourceTime * 100) / 100,
    };
  }
}

export const performanceMonitor = new PerformanceMonitor();
