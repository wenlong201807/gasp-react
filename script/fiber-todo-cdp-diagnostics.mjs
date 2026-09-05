#!/usr/bin/env node
/**
 * Development-only CDP diagnostics for Fiber Todo.
 * Usage: node script/fiber-todo-cdp-diagnostics.mjs [--url URL] [--port PORT] [--out DIR]
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const value = process.argv[i];
  if (value.startsWith('--')) args.set(value.slice(2), process.argv[i + 1] ?? true);
}

const cdpPort = Number(args.get('port') ?? process.env.CDP_PORT ?? 9222);
const appUrl = String(args.get('url') ?? 'http://127.0.0.1:5173/');
const outputDir = String(args.get('out') ?? 'script/artifacts');
const timeoutMs = 15_000;

const requestJson = async (url) => {
  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error(
      `无法连接 CDP ${url}：请先启动带 --remote-debugging-port=${cdpPort} 的 Chromium。${error.message}`
    );
  }
  if (!response.ok) {
    throw new Error(
      `CDP 地址不可用：${url} 返回 HTTP ${response.status}。${
        response.status === 404
          ? `端口 ${cdpPort} 很可能是 Vite/其他 HTTP 服务，而不是 Chromium CDP；请使用 --port 指向 Chromium 的远程调试端口。`
          : ''
      }`
    );
  }
  return response.json();
};

const withTimeout = (promise, label) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs)),
  ]);

class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 0;
    this.pending = new Map();
    this.events = new Map();
    this.socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
        else pending.resolve(message.result);
        return;
      }
      const listeners = this.events.get(message.method) ?? [];
      for (const listener of listeners) listener(message.params ?? {});
    };
  }

  async connect() {
    await withTimeout(
      new Promise((resolve, reject) => {
        this.socket.addEventListener('open', resolve, { once: true });
        this.socket.addEventListener('error', () => reject(new Error('CDP WebSocket error')), { once: true });
      }),
      'CDP connect'
    );
  }

  on(method, listener) {
    const listeners = this.events.get(method) ?? [];
    listeners.push(listener);
    this.events.set(method, listeners);
  }

  command(method, params = {}) {
    const id = ++this.nextId;
    return withTimeout(
      new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        this.socket.send(JSON.stringify({ id, method, params }));
      }),
      method
    );
  }

  close() {
    this.socket.close();
  }
}

const evaluate = (client, expression) =>
  client.command('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }).then((result) => {
    if (result.exceptionDetails) throw new Error('Runtime evaluation failed');
    return result.result?.value;
  });

const collectStream = (client, eventName) => {
  const chunks = [];
  client.on(eventName, ({ chunk }) => chunks.push(chunk));
  return () => chunks.join('');
};

const snapshot = async (client) => {
  const read = collectStream(client, 'HeapProfiler.addHeapSnapshotChunk');
  await client.command('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
  return read();
};

const main = async () => {
  await mkdir(outputDir, { recursive: true });
  const version = await requestJson(`http://127.0.0.1:${cdpPort}/json/version`);
  const pages = await requestJson(`http://127.0.0.1:${cdpPort}/json/list`);
  const page = pages.find((item) => item.type === 'page' && item.url !== 'about:blank') ?? pages.find((item) => item.type === 'page');
  if (!page?.webSocketDebuggerUrl) throw new Error('No CDP page target found');

  const client = new CdpClient(page.webSocketDebuggerUrl);
  const traceChunks = [];
  client.on('Tracing.dataCollected', ({ value }) => traceChunks.push(...value));
  const consoleErrors = [];
  client.on('Runtime.consoleAPICalled', ({ type, args }) => {
    if (type === 'error') consoleErrors.push(args?.map((arg) => arg.value ?? arg.description).join(' '));
  });

  try {
    await client.connect();
    await client.command('Runtime.enable');
    await client.command('Performance.enable');
    await client.command('HeapProfiler.enable');
    await client.command('Page.enable');
    await client.command('Page.navigate', { url: appUrl });
    await new Promise((resolve) => setTimeout(resolve, 1_000));

    const navigateToTodo = `(() => {
      const button = [...document.querySelectorAll('button')].find((item) => item.innerText.includes('Fiber Todo'));
      button?.click();
      return Boolean(button);
    })()`;
    await evaluate(client, navigateToTodo);
    await new Promise((resolve) => setTimeout(resolve, 600));

    const baseline = await snapshot(client);
    await client.command('Tracing.start', {
      categories: 'devtools.timeline,blink.user_timing,v8.execute,disabled-by-default-v8.cpu_profiler',
      transferMode: 'ReportEvents',
    });
    await client.command('HeapProfiler.startSampling', { samplingInterval: 32_768, includeObjectsCollectedByMajorGC: true });
    let instrumentation = { supported: true };
    try {
      await client.command('HeapProfiler.startTrackingHeapObjects', { trackAllocations: true });
    } catch (error) {
      instrumentation = { supported: false, reason: error.message };
    }

    await evaluate(client, `(() => {
      const input = document.querySelector('input[placeholder*="输入内容"]');
      if (!input) throw new Error('Todo input not found');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'CDP stress probe');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      [...document.querySelectorAll('button')].find((item) => item.innerText.trim() === '添加')?.click();
      [...document.querySelectorAll('button')].find((item) => item.innerText.includes('压测 +100'))?.click();
      return true;
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 2_500));

    const metrics = await client.command('Performance.getMetrics');
    const sampling = await client.command('HeapProfiler.stopSampling');
    try {
      await client.command('HeapProfiler.stopTrackingHeapObjects');
    } catch (error) {
      instrumentation = { supported: false, reason: error.message };
    }
    const after = await snapshot(client);
    await client.command('Tracing.end');
    await new Promise((resolve) => setTimeout(resolve, 500));

    const pageData = await evaluate(client, `(() => ({
      title: document.title,
      todoVisible: document.body.innerText.includes('事件循环 · 完整操作链路'),
      operationIdVisible: document.body.innerText.includes('operationId'),
      measures: performance.getEntriesByType('measure').map(({ name, startTime, duration }) => ({ name, startTime, duration })),
      marks: performance.getEntriesByType('mark').map(({ name, startTime }) => ({ name, startTime })),
      bodyHasStressItem: document.body.innerText.includes('CDP stress probe'),
    }))()`);
    const finalMetrics = Object.fromEntries(
      metrics.metrics
        .filter(({ name }) => ['TaskDuration', 'JSHeapUsedSize', 'LayoutCount', 'RecalcStyleCount'].includes(name))
        .map(({ name, value }) => [name, value])
    );
    const stamp = new Date().toISOString().replaceAll(':', '-');
    const result = {
      chromium: { browser: version.Browser, protocol: version['Protocol-Version'] },
      target: { url: page.url, appUrl },
      operation: pageData,
      metrics: finalMetrics,
      tracing: { eventCount: traceChunks.length, categories: ['devtools.timeline', 'blink.user_timing', 'v8.execute'] },
      allocationSampling: { available: Boolean(sampling?.profile), profile: sampling?.profile ?? null },
      allocationInstrumentation: instrumentation,
      heapSnapshots: { baselineBytes: baseline.length, afterBytes: after.length },
      consoleErrors,
    };
    await writeFile(join(outputDir, `diagnostics-${stamp}.json`), JSON.stringify(result, null, 2));
    await writeFile(join(outputDir, `trace-${stamp}.json`), JSON.stringify(traceChunks));
    await writeFile(join(outputDir, `allocation-sampling-${stamp}.json`), JSON.stringify(sampling?.profile ?? { unsupported: true }));
    await writeFile(join(outputDir, `heap-before-${stamp}.heapsnapshot`), baseline);
    await writeFile(join(outputDir, `heap-after-${stamp}.heapsnapshot`), after);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    client.close();
  }
};

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});
