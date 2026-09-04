import { Layout } from '@/components/layout';
import { FPSPanel } from '@/components/fps';
import { WebVitalsPanel } from '@/components/performance';
import { ScrollAnimation } from '@/components/scroll-animation';
import { LottieAnimation } from '@/components/lottie';
import { AnimationControls } from '@/components/controls';
import { FireworksCanvas } from '@/components/fireworks/FireworksCanvas';
import { DanceCanvas } from '@/components/canvas-dance/DanceCanvas';
import { ParticleText } from '@/components/particle-text/ParticleText';
import { StarCanvas } from '@/components/star-canvas/StarCanvas';
import { CountdownCanvas } from '@/components/countdown-canvas/CountdownCanvas';
import { FlameText } from '@/components/flame-text/FlameText';
import { ParticleProgress } from '@/components/particle-progress/ParticleProgress';
import { FiberTodoPage } from '@/components/fiber-todo/FiberTodoPage';
import { useState } from 'react';

type AnimationType =
  | 'menu'
  | 'scroll'
  | 'lottie'
  | 'fireworks'
  | 'dance'
  | 'particle-text'
  | 'star'
  | 'countdown'
  | 'flame'
  | 'particle-progress'
  | 'fiber-todo';

function App() {
  const [currentAnimation, setCurrentAnimation] = useState<AnimationType>('menu');

  const renderAnimation = () => {
    switch (currentAnimation) {
      case 'scroll':
        return <ScrollAnimation />;
      case 'lottie':
        return <LottieAnimation />;
      case 'fireworks':
        return <FireworksCanvas />;
      case 'dance':
        return <DanceCanvas />;
      case 'particle-text':
        return <ParticleText />;
      case 'star':
        return <StarCanvas />;
      case 'countdown':
        return <CountdownCanvas />;
      case 'flame':
        return <FlameText />;
      case 'particle-progress':
        return <ParticleProgress />;
      case 'fiber-todo':
        return <FiberTodoPage />;
      case 'menu':
      default:
        return <MenuPage onSelect={setCurrentAnimation} />;
    }
  };

  return (
    <Layout>
      <FPSPanel />
      <WebVitalsPanel />
      {renderAnimation()}
      <AnimationControls
        onAnimationChange={(value) => setCurrentAnimation(value as AnimationType)}
        currentAnimation={currentAnimation}
      />
    </Layout>
  );
}

const MenuPage: React.FC<{ onSelect: (type: AnimationType) => void }> = ({ onSelect }) => {
  const animations = [
    { id: 'scroll', name: 'Scroll Animation', icon: '📜', color: 'from-blue-500 to-purple-500' },
    { id: 'lottie', name: 'Lottie Animation', icon: '🎨', color: 'from-pink-500 to-rose-500' },
    { id: 'fireworks', name: 'Fireworks', icon: '🎆', color: 'from-yellow-500 to-orange-500' },
    { id: 'dance', name: 'Dance Canvas', icon: '💃', color: 'from-cyan-500 to-blue-500' },
    { id: 'particle-text', name: 'Particle Text', icon: '✨', color: 'from-purple-500 to-pink-500' },
    { id: 'star', name: 'Star Canvas', icon: '⭐', color: 'from-indigo-500 to-purple-500' },
    { id: 'countdown', name: 'Countdown', icon: '⏰', color: 'from-red-500 to-yellow-500' },
    { id: 'flame', name: 'Flame Text', icon: '🔥', color: 'from-orange-500 to-red-500' },
    { id: 'particle-progress', name: 'Particle Progress', icon: '', color: 'from-green-500 to-emerald-500' },
    { id: 'fiber-todo', name: 'Fiber Todo', icon: '🧬', color: 'from-emerald-500 to-teal-500' },
  ] as const;

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-slate-900 via-zinc-900 to-black p-8">
      <div className="max-w-7xl mx-auto">
        <header className="mb-16 text-center">
          <h1 className="text-6xl font-bold bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent mb-4">
            Gasp-React
          </h1>
          <p className="text-white/60 text-xl font-light">高性能动画展示 · P10 性能优等标准</p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {animations.map((animation) => (
            <button
              key={animation.id}
              onClick={() => onSelect(animation.id as AnimationType)}
              className="group relative overflow-hidden bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-8 hover:bg-white/10 transition-all duration-300 hover:scale-105"
            >
              <div
                className={`absolute inset-0 bg-gradient-to-r ${animation.color} opacity-0 group-hover:opacity-20 transition-opacity duration-300`}
              />
              <div className="relative">
                <div className="text-6xl mb-4">{animation.icon}</div>
                <h3 className="text-white text-xl font-semibold mb-2">{animation.name}</h3>
                <p className="text-white/60 text-sm">
                  {animation.id === 'scroll' && '滚动触发的动画效果'}
                  {animation.id === 'lottie' && 'Lottie JSON 动画'}
                  {animation.id === 'fireworks' && 'Canvas 3D 倒计时爆炸特效'}
                  {animation.id === 'dance' && 'Canvas 粒子模拟效果'}
                  {animation.id === 'particle-text' && 'Canvas 粒子效果文字动画'}
                  {animation.id === 'star' && 'Canvas 鼠标滑过星空背景'}
                  {animation.id === 'countdown' && 'Canvas 3D 倒计时爆炸'}
                  {animation.id === 'flame' && 'HTML5 火焰文字特效'}
                  {animation.id === 'particle-progress' && 'H5C3 粒子效果进度条'}
                  {animation.id === 'fiber-todo' && 'React Fiber 增删改查 · 真实 DOM 动画 · 全链路性能'}
                </p>
              </div>
            </button>
          ))}
        </div>

        <footer className="mt-16 text-center text-white/40 text-sm">
          <p>所有动画均接入 Web Vitals · FPS · 内存 · 网络监控</p>
          <p className="mt-2">遵循 P10 性能优等标准 · LCP ≤ 2.5s · CLS ≤ 0.1 · FPS ≥ 60</p>
        </footer>
      </div>
    </div>
  );
};

export default App;