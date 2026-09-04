# GSAP-React 超级酷炫动画设计方案

> **项目定位**：打造一个极致酷炫的动画展示页面，融合 CSS3/GSAP/Lottie 三种动画技术栈，解决复杂交互 + 60FPS 不掉帧的核心难题。
>
> **技术栈**：pnpm + React 18 + Vite 5 + TypeScript + Oxlint + Docker
>
> **参考**：GSAP 官网动画效果 + Codewars 挑战赛风格

---

## 1. 项目概述

### 1.1 一句话定位

**一个高性能动画展示站，通过 ScrollTrigger 滚动驱动 + Lottie 矢量动画 + GSAP 复杂交互，实现 60FPS 丝滑体验，并实时监控 Web Vitals 指标。**

### 1.2 核心目标

| 目标 | 指标 | 实现方式 |
|---|---|---|
| **60FPS 不掉帧** | FPS ≥ 58，持续稳定 | GPU 加速 + 批量渲染 + will-change 优化 |
| **Web Vitals 达标** | LCP < 2.5s, FID < 100ms, CLS < 0.1 | 懒加载 + 防布局抖动 + 性能监控 |
| **复杂交互动画** | 3+ 种交互模式 | 拖拽 + 悬停 + 滚动 + 点击 |
| **Lottie 集成** | 2+ 个 Lottie 动画 | 进度同步 + 颜色替换 |
| **可视化性能面板** | 实时 FPS/内存监控 | requestAnimationFrame + Performance API |

---

## 2. 性能难点设计

### 2.1 浏览器渲染机制全解析

```
┌─────────────────────────────────────────────────────────────────────┐
│                        浏览器渲染流水线                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   JS 执行 ──→ 样式计算 ──→ 布局 ──→ 绘制 ──→ 合成 ──→ 屏幕显示       │
│      │            │          │        │        │          │         │
│      ▼            ▼          ▼        ▼        ▼          ▼         │
│   requestAnimationFrame 触发的时机点                                  │
│                                                                     │
│   60FPS = 16.67ms/帧                                                │
│   GSAP 在 rAF 之前完成插值计算，在 rAF 时提交渲染                     │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 性能瓶颈识别

| 瓶颈类型 | 触发条件 | 解决方案 |
|---|---|---|
| **主线程阻塞** | JS 执行超过 16ms | Web Worker 计算 + GSAP 批量 |
| **重排 (Reflow)** | 修改 width/height/top/left | 改用 transform |
| **重绘 (Repaint)** | 修改 background/border | 使用 GPU 加速属性 |
| **层爆炸 (Layer Explosion)** | 过多 will-change | 按需声明 + 合并层 |
| **内存泄漏** | 未清理事件监听 | gsap.context() 生命周期管理 |
| **垃圾回收停顿** | 频繁创建对象 | 对象池复用 |

### 2.3 FPS 保证策略

```typescript
// 核心性能策略
const PERFORMANCE_STRATEGY = {
  // 1. GPU 加速属性白名单
  GPU_PROPS: ['transform', 'opacity', 'clipPath'],
  
  // 2. 避免的属性黑名单
  AVOID_PROPS: ['width', 'height', 'top', 'left', 'margin', 'padding'],
  
  // 3. will-change 生命周期
  WILL_CHANGE: {
    BEFORE: 'transform, opacity',
    AFTER: 'auto',
    DURATION: 300 // 动画完成后 300ms 清理
  },
  
  // 4. 批量渲染阈值
  BATCH_SIZE: 50,
  
  // 5. 丢帧容忍度
  LAG_SMOOTHING: {
    TOLERANCE: 100,  // 100ms 内平滑
    SKIP_FRAMES: 20  // 超过 20 帧丢失时丢弃
  }
};
```

---

## 3. 复杂交互设计

### 3.1 交互矩阵

| 交互类型 | 实现技术 | 动画表现 | 性能要求 |
|---|---|---|---|
| **滚动驱动** | ScrollTrigger + scrub | 视差滚动、序列动画、PIN | scrub 平滑度 |
| **拖拽交互** | Draggable + InertiaPlugin | 弹性拖拽、惯性释放 | 60fps 响应 |
| **悬停效果** | GSAP + CSS hover | 3D 翻转、发光效果 | 立即响应 |
| **点击反馈** | Timeline + 回调 | 涟漪扩散、状态切换 | 无延迟 |
| **Lottie 进度** | progress 属性驱动 | 矢量动画同步 | 帧对齐 |
| **视差滚动** | ScrollTrigger + transform | 多层视差 | GPU 加速 |

### 3.2 核心动画场景

#### 场景 1：Hero 区域（入口动画）

```typescript
// 组合动画序列
const heroTimeline = gsap.timeline({
  onComplete: () => {
    // 完成后启用交互
    enableHoverEffects();
    startLottieAnimation();
  }
});

heroTimeline
  .from('.hero-title', { 
    opacity: 0, 
    y: 100, 
    duration: 1.2,
    ease: 'power4.out'
  })
  .from('.hero-subtitle', {
    opacity: 0,
    y: 50,
    duration: 0.8,
    stagger: 0.1
  }, '-=0.6')
  .from('.hero-lottie', {
    scale: 0.8,
    opacity: 0,
    duration: 1,
    ease: 'elastic.out(1, 0.5)'
  }, '-=0.4')
  .from('.hero-cta', {
    opacity: 0,
    y: 30,
    duration: 0.6
  }, '-=0.3');
```

#### 场景 2：滚动驱动 Lottie

```typescript
// Lottie 进度与滚动同步
ScrollTrigger.create({
  trigger: '.lottie-section',
  start: 'top center',
  end: 'bottom center',
  scrub: 1,  // 平滑跟随滚动
  onUpdate: (self) => {
    // 直接驱动 Lottie 进度
    lottieRef.current?.setProgress(self.progress);
  }
});
```

#### 场景 3：拖拽 + 惯性

```typescript
const draggable = Draggable.create('.draggable-card', {
  type: 'x,y',
  inertia: true,
  bounds: '.drag-container',
  onDragStart: () => {
    gsap.to('.draggable-card', { scale: 1.05, duration: 0.2 });
  },
  onDragEnd: function() {
    // 释放后弹性回弹
    gsap.to('.draggable-card', {
      x: 0,
      y: 0,
      duration: 0.8,
      ease: 'elastic.out(1, 0.4)'
    });
  }
});
```

### 3.3 交互防抖策略

```typescript
// 高频交互节流
class InteractionThrottle {
  private lastTime = 0;
  private throttle = 16; // 60fps = 16.67ms

  handle(type: 'scroll' | 'drag' | 'hover', callback: () => void) {
    const now = performance.now();
    if (now - this.lastTime < this.throttle) return;
    this.lastTime = now;
    callback();
  }
}
```

---

## 4. Lottie 集成方案

### 4.1 Lottie 动画类型

| 位置 | Lottie 文件 | 用途 | 驱动方式 |
|---|---|---|---|
| Hero | hero-loader.json | 品牌 Logo 动画 | autoPlay + loop |
| Features | feature-icon-*.json | 功能图标动画 | scrollTrigger |
| Testimonials | quote-mark.json | 引号装饰 | 静态 |
| Footer | wave.json | 波浪背景 | scroll + loop |

### 4.2 Lottie + GSAP 同步

```typescript
// 1. Lottie 进度同步到 ScrollTrigger
const lottieProgress = gsap.to({ progress: 0 }, {
  progress: 1,
  duration: 3,
  ease: 'none',
  scrollTrigger: {
    trigger: '.features-section',
    start: 'top bottom',
    end: 'bottom top',
    scrub: true
  },
  onUpdate: function() {
    lottieView.setProgress(this.targets()[0].progress);
  }
});

// 2. Lottie 颜色动态替换
const colorFilters = ref<ColorFilter[]>([
  { keypath: 'Primary', color: '#6366F1' },
  { keypath: 'Secondary', color: '#EC4899' }
]);
```

### 4.3 Lottie 性能优化

```typescript
// 1. 使用 renderMode 优化
<LottieView
  source={require('./animation.json')}
  renderMode="HARDWARE"  // GPU 渲染
  cacheComposition={true}
/>

// 2. 视口外暂停
const handleVisibilityChange = () => {
  if (document.hidden) {
    lottieRef.current?.pause();
  } else {
    lottieRef.current?.play();
  }
};
document.addEventListener('visibilitychange', handleVisibilityChange);
```

---

## 5. Web Vitals 监控方案

### 5.1 监控指标

```typescript
interface WebVitalsMetrics {
  // Core Web Vitals
  LCP: number;      // Largest Contentful Paint < 2.5s
  FID: number;      // First Input Delay < 100ms
  CLS: number;      // Cumulative Layout Shift < 0.1
  
  // 自定义指标
  FPS: number;      // 帧率
  TTFB: number;     // Time to First Byte
  TTI: number;      // Time to Interactive
  TBT: number;      // Total Blocking Time
  Memory: number;   // 内存使用 (MB)
}

// 实时监控状态
const metricsStore = reactive<WebVitalsMetrics>({
  LCP: 0,
  FID: 0,
  CLS: 0,
  FPS: 60,
  TTFB: 0,
  TTI: 0,
  TBT: 0,
  Memory: 0
});
```

### 5.2 Performance Observer 实现

```typescript
// 1. LCP 监控
const lcpObserver = new PerformanceObserver((list) => {
  const entries = list.getEntries();
  const lastEntry = entries[entries.length - 1] as LargestContentfulPaint;
  metricsStore.LCP = lastEntry.startTime;
});
lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });

// 2. FID 监控
const fidObserver = new PerformanceObserver((list) => {
  const firstInput = list.getEntries()[0] as EventTiming;
  metricsStore.FID = firstInput.processingStart - firstInput.startTime;
});
fidObserver.observe({ type: 'first-input', buffered: true });

// 3. CLS 监控
let clsValue = 0;
const clsObserver = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    if (!(entry as LayoutShift).hadRecentInput) {
      clsValue += (entry as LayoutShift).value;
    }
  }
  metricsStore.CLS = clsValue;
});
clsObserver.observe({ type: 'layout-shift', buffered: true });
```

### 5.3 FPS 实时监控

```typescript
// FPS 监控器
class FPSMonitor {
  private frames = 0;
  private lastTime = performance.now();
  private rafId: number | null = null;
  private callbacks: ((fps: number) => void)[] = [];

  start() {
    const tick = () => {
      this.frames++;
      const now = performance.now();
      const delta = now - this.lastTime;
      
      if (delta >= 1000) {
        const fps = Math.round((this.frames * 1000) / delta);
        this.callbacks.forEach(cb => cb(fps));
        this.frames = 0;
        this.lastTime = now;
      }
      
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  onUpdate(callback: (fps: number) => void) {
    this.callbacks.push(callback);
  }
}
```

### 5.4 性能面板组件

```tsx
// 性能监控面板
function PerformancePanel() {
  const [metrics, setMetrics] = useState<WebVitalsMetrics>({...});
  
  // 实时更新
  useEffect(() => {
    const fpsMonitor = new FPSMonitor();
    fpsMonitor.onUpdate((fps) => {
      setMetrics(prev => ({ ...prev, FPS: fps }));
    });
    fpsMonitor.start();
    
    return () => fpsMonitor.stop();
  }, []);
  
  return (
    <div className="perf-panel">
      <div className={`fps-indicator ${metrics.FPS < 30 ? 'danger' : metrics.FPS < 50 ? 'warning' : 'good'}`}>
        {metrics.FPS} FPS
      </div>
      <div className="metrics-grid">
        <Metric label="LCP" value={metrics.LCP} threshold={2500} />
        <Metric label="FID" value={metrics.FID} threshold={100} />
        <Metric label="CLS" value={metrics.CLS} threshold={0.1} />
      </div>
    </div>
  );
}
```

---

## 6. 技术架构

### 6.1 项目结构

```
gsap-react/
├── public/
│   └── lottie/
│       ├── hero-loader.json
│       ├── feature-icon-1.json
│       └── wave.json
├── src/
│   ├── components/
│   │   ├── animations/
│   │   │   ├── HeroSection.tsx
│   │   │   ├── FeaturesSection.tsx
│   │   │   ├── ScrollSection.tsx
│   │   │   └── DraggableSection.tsx
│   │   ├── lottie/
│   │   │   └── LottieWrapper.tsx
│   │   ├── perf/
│   │   │   ├── PerformancePanel.tsx
│   │   │   └── FPSMonitor.tsx
│   │   └── socket/
│   │       └── SocketProvider.tsx
│   ├── hooks/
│   │   ├── useGSAP.ts
│   │   ├── useScrollTrigger.ts
│   │   ├── useWebVitals.ts
│   │   ├── useFPS.ts
│   │   └── useSocket.ts
│   ├── utils/
│   │   ├── perf.ts          # 性能工具
│   │   ├── lottie.ts        # Lottie 工具
│   │   └── socket.ts        # Socket 工具
│   ├── styles/
│   │   └── animations.css
│   ├── App.tsx
│   └── main.tsx
├── docker/
│   ├── Dockerfile           # 多阶段构建
│   ├── docker-compose.yml   # 开发/生产编排
│   └── nginx.conf           # Nginx 配置
├── scripts/
│   ├── deploy.sh            # 一键部署脚本
│   └── health-check.sh      # 健康检查脚本
├── .nvmrc                  # Node 版本锁定
├── oxlintrc.json           # Oxlint 配置
├── oxformatrc.json         # Oxformat 配置
├── .env.example            # 环境变量示例
├── package.json
├── vite.config.ts
└── tsconfig.json
```

### 6.2 依赖配置

```json
{
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "gsap": "^3.12.5",
    "lottie-react": "^2.4.0",
    "web-vitals": "^3.5.0",
    "socket.io-client": "^4.7.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "@vitejs/plugin-react": "^4.2.0",
    "typescript": "^5.3.0",
    "vite": "^5.0.0",
    "oxlint": "^0.3.0",
    "oxformat": "^0.3.0"
  }
}
```

### 6.3 Vite 配置优化

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ['gsap', 'lottie-react']
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'gsap': ['gsap'],
          'lottie': ['lottie-react']
        }
      }
    }
  }
});
```

---

## 7. 动画场景详细设计

### 7.1 场景 1：Hero 入口（3D 粒子 + Lottie）

```typescript
// 3D 粒子效果 + Lottie 同步
function HeroSection() {
  const containerRef = useRef<HTMLDivElement>(null);
  const lottieRef = useRef<LottieRef>(null);
  
  useGSAP(() => {
    // 粒子初始化
    createParticles(containerRef.current);
    
    // Lottie 动画驱动
    const tl = gsap.timeline();
    tl.to('.particle', {
      scale: 1,
      opacity: 1,
      stagger: { amount: 0.8, from: 'random' },
      duration: 1.5,
      ease: 'power2.out'
    });
    
    // Lottie 进度同步
    tl.to(lottieRef.current, {
      duration: 2,
      onUpdate: function() {
        const progress = this.progress();
        lottieRef.current?.setProgress(progress);
      }
    }, 0);
  }, { scope: containerRef });
  
  return (
    <section ref={containerRef} className="hero">
      <div className="particles-container" />
      <LottieWrapper ref={lottieRef} src="/lottie/hero-loader.json" />
    </section>
  );
}
```

### 7.2 场景 2：视差滚动卡片

```typescript
// 视差滚动 + 3D 翻转
function ParallaxCards() {
  const cards = gsap.utils.toArray('.parallax-card') as HTMLElement[];
  
  cards.forEach((card, i) => {
    // 视差移动
    gsap.to(card, {
      y: -100 * (i % 2 === 0 ? 1 : -1),
      rotateY: 15 * (i % 2 === 0 ? 1 : -1),
      scrollTrigger: {
        trigger: card,
        start: 'top bottom',
        end: 'bottom top',
        scrub: 1.5
      }
    });
    
    // 悬停效果
    card.addEventListener('mouseenter', () => {
      gsap.to(card, {
        scale: 1.05,
        boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
        duration: 0.3
      });
    });
    
    card.addEventListener('mouseleave', () => {
      gsap.to(card, {
        scale: 1,
        boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)',
        duration: 0.3
      });
    });
  });
}
```

### 7.3 场景 3：拖拽释放 + 物理回弹

```typescript
// Draggable + InertiaPlugin
function DraggableSection() {
  const containerRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    const ctx = gsap.context(() => {
      Draggable.create('.drag-item', {
        type: 'x,y',
        bounds: '.drag-container',
        edgeResistance: 0.65,
        inertia: true,
        onDragStart: function() {
          gsap.to(this.target, {
            scale: 1.1,
            zIndex: 100,
            duration: 0.2
          });
        },
        onDragEnd: function() {
          // 弹性回弹到原点
          gsap.to(this.target, {
            x: 0,
            y: 0,
            scale: 1,
            zIndex: 1,
            duration: 0.8,
            ease: 'elastic.out(1, 0.4)'
          });
        }
      });
    }, containerRef);
    
    return () => ctx.revert();
  }, []);
  
  return (
    <div ref={containerRef} className="drag-container">
      <div className="drag-item">拖我！</div>
    </div>
  );
}
```

### 7.4 场景 4：滚动序列动画

```typescript
// PIN + 序列动画
function ScrollSequence() {
  useGSAP(() => {
    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: '.sequence-section',
        start: 'top top',
        end: '+=2000',
        pin: true,
        scrub: 1,
        anticipatePin: 1
      }
    });
    
    tl.to('.step-1', { opacity: 1, scale: 1, duration: 1 })
      .to('.step-1', { opacity: 0, y: -50, duration: 0.5 }, '+=0.5')
      .to('.step-2', { opacity: 1, scale: 1, duration: 1 }, '+=0.5')
      .to('.step-2', { opacity: 0, y: -50, duration: 0.5 }, '+=0.5')
      .to('.step-3', { opacity: 1, scale: 1, duration: 1 }, '+=0.5');
  });
}
```

---

## 8. 性能优化实施

### 8.1 GSAP 优化

```typescript
// 1. 使用 gsap.context 管理生命周期
function AnimationComponent() {
  const containerRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    const ctx = gsap.context(() => {
      // 所有动画在这个作用域内
      gsap.to('.element', { x: 100 });
    }, containerRef);
    
    return () => ctx.revert();  // 清理所有动画和事件
  }, []);
  
  return <div ref={containerRef}><div className="element" /></div>;
}

// 2. 批量处理
gsap.batch('.items', {
  animate: { opacity: 1, y: 0 },
  stagger: 0.1,
  scrollTrigger: {
    trigger: '.container',
    start: 'top 80%'
  }
});

// 3. will-change 智能声明
gsap.set('.animated-element', { willChange: 'transform, opacity' });
// ... 动画 ...
gsap.set('.animated-element', { willChange: 'auto', clearProps: 'willChange' });
```

### 8.2 React 优化

```typescript
// 1. 使用 React.memo 避免不必要渲染
const LottieWrapper = React.memo(({ src, progress }) => {
  return <Lottie lottieRef={lottieRef} src={src} progress={progress} />;
});

// 2. 使用 useCallback 稳定回调
const handleScrollUpdate = useCallback((self) => {
  lottieRef.current?.setProgress(self.progress);
}, []);

// 3. 使用 requestIdleCallback 处理非紧急任务
requestIdleCallback(() => {
  preloadLottieAssets();
});
```

### 8.3 Lottie 优化

```typescript
// 1. 视口检测
const [isVisible, setIsVisible] = useState(false);

useEffect(() => {
  const observer = new IntersectionObserver(
    ([entry]) => setIsVisible(entry.isIntersecting),
    { threshold: 0.1 }
  );
  
  if (containerRef.current) {
    observer.observe(containerRef.current);
  }
  
  return () => observer.disconnect();
}, []);

// 2. 可见时播放
useEffect(() => {
  if (isVisible) {
    lottieRef.current?.play();
  } else {
    lottieRef.current?.pause();
  }
}, [isVisible]);
```

---

## 9. 验收标准

### 9.1 性能指标

| 指标 | 目标值 | 测量方法 |
|---|---|---|
| **FPS** | ≥ 58 (持续) | FPS Monitor 实时显示 |
| **LCP** | < 2.5s | web-vitals |
| **FID** | < 100ms | Performance Observer |
| **CLS** | < 0.1 | Layout Shift Observer |
| **内存** | < 150MB | performance.memory |

### 9.2 交互验收

| 交互 | 预期行为 | 验收条件 |
|---|---|---|
| **滚动驱动** | Lottie 进度与滚动同步 | 滚动时 Lottie 进度线性变化 |
| **拖拽释放** | 弹性回弹到原点 | 释放后 0.8s 内回到起点 |
| **悬停效果** | 立即响应无延迟 | 鼠标进入 50ms 内开始动画 |
| **PIN 效果** | 固定区域序列播放 | 滚动时代码片段依次高亮 |

### 9.3 视觉验收

| 场景 | 视觉效果 | 检查点 |
|---|---|---|
| **Hero** | 3D 粒子 + Lottie 组合 | 粒子和 Lottie 同时入场 |
| **Features** | 视差卡片 3D 翻转 | 滚动时 Z 轴旋转 |
| **Draggable** | 拖拽 + 惯性 | 释放后沿拖拽方向惯性滑动 |
| **Performance Panel** | 实时 FPS/指标显示 | 数值每秒更新，颜色随状态变化 |

---

## 10. 实现计划

### Phase 1: 基础搭建（1 天）
- [ ] 项目初始化 (pnpm + Vite + React 18)
- [ ] GSAP + ScrollTrigger + Draggable 集成
- [ ] Lottie-React 集成
- [ ] 基础目录结构

### Phase 2: 性能监控（1 天）
- [ ] FPS Monitor 实现
- [ ] Web Vitals Observer 集成
- [ ] Performance Panel 组件
- [ ] 性能指标实时显示

### Phase 3: 核心动画（2 天）
- [ ] Hero 入口动画
- [ ] 视差滚动卡片
- [ ] 拖拽交互
- [ ] PIN 序列动画

### Phase 4: Lottie 集成（1 天）
- [ ] Lottie 组件封装
- [ ] ScrollTrigger 进度同步
- [ ] 颜色动态替换
- [ ] 视口检测优化

### Phase 5: 优化调优（1 天）
- [ ] GPU 加速属性检查
- [ ] will-change 优化
- [ ] 内存泄漏排查
- [ ] FPS 稳定性测试

---

## 12. Socket.IO 实时渲染

### 12.1 Socket.IO 集成架构

```typescript
// src/utils/socket.ts
import { io, Socket } from 'socket.io-client';

interface ServerToClientEvents {
  'fps:update': (data: { fps: number; memory: number }) => void;
  'animation:sync': (data: { id: string; progress: number }) => void;
  'theme:change': (theme: 'light' | 'dark') => void;
}

interface ClientToServerEvents {
  'fps:report': (data: { fps: number }) => void;
  'page:view': (data: { url: string }) => void;
}

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(
  process.env.VITE_SOCKET_URL || 'ws://localhost:3001',
  {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000
  }
);
```

### 12.2 Socket  Provider

```tsx
// src/components/socket/SocketProvider.tsx
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { socket } from '@/utils/socket';

interface SocketContextType {
  isConnected: boolean;
  emit: typeof socket.emit;
  on: typeof socket.on;
  off: typeof socket.off;
}

const SocketContext = createContext<SocketContextType | null>(null);

export function SocketProvider({ children }: { children: ReactNode }) {
  const [isConnected, setIsConnected] = useState(socket.connected);

  useEffect(() => {
    socket.on('connect', () => setIsConnected(true));
    socket.on('disconnect', () => setIsConnected(false));

    return () => {
      socket.off('connect');
      socket.off('disconnect');
    };
  }, []);

  return (
    <SocketContext.Provider value={{ isConnected, emit: socket.emit.bind(socket), on: socket.on.bind(socket), off: socket.off.bind(socket) }}>
      {children}
    </SocketContext.Provider>
  );
}

export const useSocket = () => {
  const context = useContext(SocketContext);
  if (!context) throw new Error('useSocket must be used within SocketProvider');
  return context;
};
```

### 12.3 FPS 实时同步

```tsx
// src/hooks/useSocketFPS.ts
import { useEffect, useRef } from 'react';
import { useSocket } from '@/components/socket/SocketProvider';
import { FPSMonitor } from '@/utils/fps';

export function useSocketFPS(interval = 5000) {
  const { emit, isConnected } = useSocket();
  const fpsMonitorRef = useRef<FPSMonitor | null>(null);

  useEffect(() => {
    if (!isConnected) return;

    fpsMonitorRef.current = new FPSMonitor();
    fpsMonitorRef.current.onUpdate((fps) => {
      emit('fps:report', { fps });
    });
    fpsMonitorRef.current.start();

    return () => {
      fpsMonitorRef.current?.stop();
    };
  }, [isConnected, emit]);
}
```

### 12.4 远程动画控制

```tsx
// src/components/RemoteAnimationController.tsx
import { useEffect } from 'react';
import { useSocket } from './socket/SocketProvider';

interface AnimationState {
  id: string;
  progress: number;
}

export function RemoteAnimationController({ animations }: { animations: Map<string, (progress: number) => void> }) {
  const { on, off } = useSocket();

  useEffect(() => {
    const handler = (data: AnimationState) => {
      const controller = animations.get(data.id);
      if (controller) {
        controller(data.progress);
      }
    };

    on('animation:sync', handler);
    return () => off('animation:sync', handler);
  }, [on, off, animations]);

  return null;
}
```

---

## 13. Oxlint + Oxformat 代码规范

### 13.1 Oxlint 配置

```json
// oxlintrc.json
{
  "$schema": "https://raw.githubusercontent.com/oxc-project/oxlint/main/oxlintrc.schema.json",
  "rules": {
    "no-console": "warn",
    "no-debugger": "error",
    "prefer-const": "error",
    "no-var": "error",
    "eqeqeq": "error",
    "no-unused-vars": "error",
    "no-empty": "warn",
    "no-sparse-arrays": "error",
    "no-prototype-builtins": "error",
    "prefer-spread": "warn",
    "no-proto": "error",
    "no-eval": "error",
    "no-with": "error",
    "no-implicit-coercion": "warn",
    "react-hooks": {
      "exhaustive-deps": "error",
      "rules-of-hooks": "error"
    }
  }
}
```

### 13.2 Oxformat 配置

```json
// oxformatrc.json
{
  "$schema": "https://raw.githubusercontent.com/oxc-project/oxlint/main/oxformatrc.schema.json",
  "format": {
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100,
    "semicolons": true,
    "quoteStyle": "double",
    "quoteProps": "consistent",
    "trailingCommas": "es5",
    "arrowParens": "always",
    "singleQuote": false,
    "jsxQuoteStyle": "double"
  }
}
```

### 13.3 package.json scripts

```json
{
  "scripts": {
    "lint": "oxlint . --import-plugin --jsx-a11y-plugin",
    "lint:fix": "oxlint . --import-plugin --jsx-a11y-plugin --fix",
    "format": "oxformat .",
    "format:check": "oxformat --check .",
    "lint+format": "pnpm run lint && pnpm run format",
    "pre-commit": "pnpm run lint+format"
  }
}
```

### 13.4 Git Hooks 配置

```yaml
# .husky/pre-commit
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

pnpm run pre-commit
```

```json
// package.json
{
  "husky": {
    "hooks": {
      "pre-commit": "pnpm run pre-commit"
    }
  }
}
```

---

## 14. Node 版本控制

### 14.1 .nvmrc 配置

```bash
# .nvmrc
20.11.0
```

### 14.2 .node-version 文件（兼容其他工具）

```bash
# .node-version
20.11.0
```

### 14.3 package.json engines

```json
{
  "engines": {
    "node": ">=20.11.0",
    "pnpm": ">=8.0.0"
  }
}
```

### 14.4 .envrc 自动切换（direnv）

```bash
# .envrc
use nvm
```

### 14.5 验证脚本

```bash
#!/bin/bash
# scripts/check-node-version.sh

REQUIRED_NODE="20.11.0"
CURRENT_NODE=$(node -v | cut -d'v' -f2)

if [ "$CURRENT_NODE" != "$REQUIRED_NODE" ]; then
  echo "❌ Node version mismatch!"
  echo "   Required: $REQUIRED_NODE"
  echo "   Current:  $CURRENT_NODE"
  echo ""
  echo "Run: nvm use"
  exit 1
fi

echo "✅ Node version: $CURRENT_NODE"
```

---

## 15. Docker 部署

### 15.1 多阶段 Dockerfile

```dockerfile
# docker/Dockerfile

# ============ 构建阶段 ============
FROM node:20.11.0-alpine AS builder

WORKDIR /app

# 安装 pnpm
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

# 复制依赖文件
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# 复制源码
COPY . .

# 构建
RUN pnpm run build

# ============ 生产阶段 ============
FROM nginx:alpine AS production

# 复制构建产物
COPY --from=builder /app/dist /usr/share/nginx/html

# 复制 Nginx 配置
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

# 暴露端口
EXPOSE 80

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:80/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
```

### 15.2 docker-compose.yml

```yaml
# docker/docker-compose.yml

services:
  # 开发环境
  dev:
    build:
      context: ..
      dockerfile: docker/Dockerfile
      target: builder
    ports:
      - "5173:5173"
    volumes:
      - ..:/app
      - /app/node_modules
    environment:
      - NODE_ENV=development
      - VITE_SOCKET_URL=ws://localhost:3001
    command: pnpm dev

  # 生产环境
  production:
    build:
      context: ..
      dockerfile: docker/Dockerfile
      target: production
    ports:
      - "80:80"
      - "443:443"
    environment:
      - NODE_ENV=production
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:80/health"]
      interval: 30s
      timeout: 3s
      retries: 3

  # Socket.IO 服务器（可选）
  socket-server:
    image: node:20.11.0-alpine
    working_dir: /app
    ports:
      - "3001:3001"
    volumes:
      - ../socket-server:/app
    command: node index.js
    restart: unless-stopped
```

### 15.3 Nginx 配置

```nginx
# docker/nginx.conf

server {
    listen 80;
    server_name localhost;
    root /usr/share/nginx/html;
    index index.html;

    # Gzip 压缩
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/javascript application/json application/xml+rss image/svg+xml;

    # 静态资源缓存
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # HTML 不缓存
    location ~* \.html$ {
        expires -1;
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }

    # SPA 路由 fallback
    location / {
        try_files $uri $uri/ /index.html;
    }

    # 健康检查端点
    location /health {
        access_log off;
        return 200 "OK";
    }

    # Socket.IO WebSocket
    location /socket.io/ {
        proxy_pass http://socket-server:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # 安全头
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
}
```

### 15.4 生产环境变量

```bash
# .env.production
NODE_ENV=production
VITE_SOCKET_URL=wss://your-domain.com
VITE_API_URL=https://api.your-domain.com
```

---

## 16. 部署脚本

### 16.1 一键部署脚本

```bash
#!/bin/bash
# scripts/deploy.sh

set -euo pipefail

# ============ 配置 ============
APP_NAME="gsap-react"
DEPLOY_DIR="/opt/${APP_NAME}"
BACKUP_DIR="/opt/${APP_NAME}/backups"
DOCKER_REGISTRY="registry.example.com"
IMAGE_TAG="${1:-latest}"
LOG_FILE="/var/log/${APP_NAME}/deploy.log"

# ============ 颜色输出 ============
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() {
    echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

success() { log "${GREEN}✅ $1${NC}"; }
warn() { log "${YELLOW}⚠️  $1${NC}"; }
error() { log "${RED}❌ $1${NC}"; exit 1; }

# ============ 前置检查 ============
check_requirements() {
    log "🔍 检查环境要求..."

    command -v docker >/dev/null 2>&1 || error "Docker 未安装"
    command -v pnpm >/dev/null 2>&1 || error "pnpm 未安装"

    # 检查 Node 版本
    source .nvmrc
    [[ "$(node -v)" == "v20.11.0" ]] || warn "Node 版本不是 20.11.0"

    success "环境检查通过"
}

# ============ 代码拉取 ============
pull_code() {
    log "📥 拉取最新代码..."

    if [ -d ".git" ]; then
        git pull origin main || error "Git 拉取失败"
        git checkout . || error "Git checkout 失败"
    fi

    success "代码更新完成"
}

# ============ 依赖安装 ============
install_deps() {
    log "📦 安装依赖..."

    pnpm install --frozen-lockfile || error "依赖安装失败"

    success "依赖安装完成"
}

# ============ 代码检查 ============
lint_and_format() {
    log "🔍 代码检查..."

    pnpm run lint || error "Lint 检查失败"
    pnpm run format:check || error "Format 检查失败"

    success "代码检查通过"
}

# ============ 构建 ============
build() {
    log "🏗️  构建应用..."

    pnpm run build || error "构建失败"

    success "构建完成"
}

# ============ Docker 构建 ============
docker_build() {
    log "🐳 Docker 镜像构建..."

    docker build \
        --tag "${DOCKER_REGISTRY}/${APP_NAME}:${IMAGE_TAG}" \
        --tag "${DOCKER_REGISTRY}/${APP_NAME}:latest" \
        --file docker/Dockerfile \
        . || error "Docker 构建失败"

    success "镜像构建完成"
}

# ============ Docker 推送 ============
docker_push() {
    log "📤 推送镜像..."

    docker push "${DOCKER_REGISTRY}/${APP_NAME}:${IMAGE_TAG}" || error "镜像推送失败"
    docker push "${DOCKER_REGISTRY}/${APP_NAME}:latest" || error "镜像推送失败"

    success "镜像推送完成"
}

# ============ 部署 ============
deploy() {
    log "🚀 开始部署..."

    # 备份
    if [ -d "${DEPLOY_DIR}" ]; then
        BACKUP_NAME="backup-$(date +%Y%m%d-%H%M%S)"
        mkdir -p "${BACKUP_DIR}"
        cp -r "${DEPLOY_DIR}" "${BACKUP_DIR}/${BACKUP_NAME}"
        warn "已备份到 ${BACKUP_DIR}/${BACKUP_NAME}"
    fi

    # 停止旧容器
    docker compose -f docker/docker-compose.yml down || true

    # 启动新容器
    docker compose -f docker/docker-compose.yml up -d || error "容器启动失败"

    success "部署完成"
}

# ============ 健康检查 ============
health_check() {
    log "🏥 健康检查..."

    sleep 5

    local retries=10
    while [ $retries -gt 0 ]; do
        if curl -sf http://localhost:80/health > /dev/null; then
            success "健康检查通过"
            return 0
        fi
        retries=$((retries - 1))
        sleep 3
    done

    error "健康检查失败"
}

# ============ 清理 ============
cleanup() {
    log "🧹 清理构建缓存..."

    docker builder prune -f || true
    docker image prune -f || true

    success "清理完成"
}

# ============ 主流程 ============
main() {
    log "=========================================="
    log "🚀 ${APP_NAME} 部署开始"
    log "=========================================="

    check_requirements
    pull_code
    install_deps
    lint_and_format
    build

    if [[ "${SKIP_DOCKER:-false}" != "true" ]]; then
        docker_build
        docker_push
        deploy
        health_check
    fi

    cleanup

    log "=========================================="
    success "${APP_NAME} 部署完成！"
    log "=========================================="
}

main "$@"
```

### 16.2 健康检查脚本

```bash
#!/bin/bash
# scripts/health-check.sh

set -euo pipefail

ENDPOINT="${1:-http://localhost:80/health}"
TIMEOUT=5

check_http() {
    if curl -sf --max-time "$TIMEOUT" "$ENDPOINT" > /dev/null; then
        echo "✅ HTTP 健康检查通过"
        return 0
    else
        echo "❌ HTTP 健康检查失败"
        return 1
    fi
}

check_process() {
    if docker ps --format '{{.Names}}' | grep -q "gsap-react"; then
        echo "✅ 容器运行中"
        return 0
    else
        echo "❌ 容器未运行"
        return 1
    fi
}

check_logs() {
    local errors
    errors=$(docker compose -f docker/docker-compose.yml logs --tail=50 2>&1 | grep -i "error\|fatal" || true)

    if [ -n "$errors" ]; then
        echo "⚠️  发现错误日志:"
        echo "$errors"
        return 1
    else
        echo "✅ 日志无错误"
        return 0
    fi
}

main() {
    echo "=========================================="
    echo "🏥 健康检查"
    echo "=========================================="

    local result=0

    check_http || result=1
    check_process || result=1
    check_logs || result=1

    echo "=========================================="

    if [ $result -eq 0 ]; then
        echo "✅ 所有检查通过"
        exit 0
    else
        echo "❌ 部分检查失败"
        exit 1
    fi
}

main "$@"
```

### 16.3 回滚脚本

```bash
#!/bin/bash
# scripts/rollback.sh

set -euo pipefail

APP_NAME="gsap-react"
BACKUP_DIR="/opt/${APP_NAME}/backups"
MAX_BACKUPS=5

rollback() {
    echo "=========================================="
    echo "⏪ 回滚 ${APP_NAME}"
    echo "=========================================="

    # 列出可用备份
    echo "📦 可用备份:"
    ls -1t "${BACKUP_DIR}" | head -n "$MAX_BACKUPS"

    # 获取最新备份
    latest_backup=$(ls -1t "${BACKUP_DIR}" | head -1)

    if [ -z "$latest_backup" ]; then
        echo "❌ 没有可用的备份"
        exit 1
    fi

    echo ""
    echo "🔄 回滚到: ${latest_backup}"
    echo ""

    # 确认
    read -p "确认回滚? (y/n) " -n 1 -r
    echo ""

    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "取消回滚"
        exit 0
    fi

    # 停止当前容器
    docker compose -f docker/docker-compose.yml down

    # 恢复备份
    rm -rf "/opt/${APP_NAME}"
    cp -r "${BACKUP_DIR}/${latest_backup}" "/opt/${APP_NAME}"

    # 重新启动
    docker compose -f docker/docker-compose.yml up -d

    echo ""
    echo "✅ 回滚完成"
    echo "=========================================="
}

rollback
```

### 16.4 GitHub Actions CI/CD

```yaml
# .github/workflows/deploy.yml

name: CI/CD Pipeline

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

env:
  NODE_VERSION: '20.11.0'
  REGISTRY: registry.example.com

jobs:
  # ============ 代码检查 ============
  lint:
    name: Lint & Format
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v2
        with:
          version: 8

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'pnpm'

      - run: pnpm install --frozen-lockfile

      - name: Run Lint
        run: pnpm run lint

      - name: Run Format Check
        run: pnpm run format:check

  # ============ 构建测试 ============
  build:
    name: Build
    runs-on: ubuntu-latest
    needs: lint
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v2
        with:
          version: 8

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'pnpm'

      - run: pnpm install --frozen-lockfile

      - name: Build
        run: pnpm run build

      - name: Upload Build Artifact
        uses: actions/upload-artifact@v4
        with:
          name: dist
          path: dist/

  # ============ Docker 构建 ============
  docker:
    name: Docker Build & Push
    runs-on: ubuntu-latest
    needs: build
    if: github.ref == 'refs/heads/main'

    permissions:
      contents: read
      packages: write

    steps:
      - uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Login to Registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ secrets.REGISTRY_USER }}
          password: ${{ secrets.REGISTRY_TOKEN }}

      - name: Download Build Artifact
        uses: actions/download-artifact@v4
        with:
          name: dist
          path: dist/

      - name: Build and Push
        uses: docker/build-push-action@v5
        with:
          context: .
          file: docker/Dockerfile
          push: true
          tags: |
            ${{ env.REGISTRY }}/gsap-react:${{ github.sha }}
            ${{ env.REGISTRY }}/gsap-react:latest

  # ============ 部署 ============
  deploy:
    name: Deploy
    runs-on: ubuntu-latest
    needs: docker
    if: github.ref == 'refs/heads/main'

    steps:
      - name: Deploy to Server
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.SERVER_HOST }}
          username: ${{ secrets.SERVER_USER }}
          key: ${{ secrets.SERVER_SSH_KEY }}
          script: |
            cd /opt/gsap-react
            ./scripts/deploy.sh
```

---

## 17. 完整项目启动流程

### 17.1 首次克隆

```bash
# 1. 克隆项目
git clone git@github.com:your-org/gsap-react.git
cd gsap-react

# 2. 自动切换 Node 版本
nvm use

# 3. 安装依赖
pnpm install

# 4. 复制环境变量
cp .env.example .env.local

# 5. 启动开发服务器
pnpm dev
```

### 17.2 Docker 开发环境

```bash
# 1. 启动所有服务
docker compose -f docker/docker-compose.yml --profile dev up

# 2. 查看日志
docker compose -f docker/docker-compose.yml logs -f

# 3. 停止服务
docker compose -f docker/docker-compose.yml down
```

### 17.3 生产部署

```bash
# 方式一：直接部署
./scripts/deploy.sh latest

# 方式二：Docker 部署
docker compose -f docker/docker-compose.yml --profile production up -d

# 方式三：GitHub Actions 自动部署
git push origin main
```

---

## 11. 附录：参考资源

### 11.1 GSAP 官网参考
- https://gsap.com/
- https://greensock.com/docs/v3/
- https://greensock.com/scrolltrigger/

### 11.2 Lottie 参考
- https://lottiefiles.com/
- https://airbnb.io/lottie/
- https://github.com/LottieFiles/lottie-player

### 11.3 性能优化参考
- https://web.dev/vitals/
- https://developers.google.com/web/fundamentals/performance/rendering
- https://developer.mozilla.org/en-US/docs/Web/Performance