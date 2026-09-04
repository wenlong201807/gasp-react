export class FPSMonitor {
  private frames: number[] = [];
  private lastTime: number = performance.now();
  private rafId: number | null = null;
  private listeners: ((fps: number) => void)[] = [];
  private maxSamples: number = 60;

  constructor() {
    this.tick = this.tick.bind(this);
  }

  private tick(): void {
    const now = performance.now();
    const delta = now - this.lastTime;
    this.lastTime = now;

    const fps = 1000 / delta;
    this.frames.push(fps);

    if (this.frames.length > this.maxSamples) {
      this.frames.shift();
    }

    this.rafId = requestAnimationFrame(this.tick);
  }

  public onUpdate(callback: (fps: number) => void): void {
    this.listeners.push(callback);
  }

  public start(): void {
    if (this.rafId === null) {
      this.lastTime = performance.now();
      this.tick();
    }
  }

  public stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  public getFPS(): number {
    if (this.frames.length === 0) return 0;
    const sum = this.frames.reduce((a, b) => a + b, 0);
    return Math.round(sum / this.frames.length);
  }

  public getMemory(): number | undefined {
    const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    return memory?.usedJSHeapSize;
  }

  public notify(): void {
    const fps = this.getFPS();
    this.listeners.forEach((callback) => callback(fps));
  }
}

export const fpsMonitor = new FPSMonitor();
