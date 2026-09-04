import { useState, useEffect } from 'react';
import { webVitalsCollector } from '@/utils/webVitals';
import type { WebVitalsMetric } from '@/utils/webVitals';

export function useWebVitals() {
  const [metrics, setMetrics] = useState<WebVitalsMetric[]>([]);

  useEffect(() => {
    const collect = () => {
      setMetrics(webVitalsCollector.getMetrics());
    };

    collect();

    const interval = setInterval(collect, 5000);
    return () => clearInterval(interval);
  }, []);

  return metrics;
}