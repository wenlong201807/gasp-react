import { Layout } from '@/components/layout';
import { FPSPanel } from '@/components/fps';
import { WebVitalsPanel } from '@/components/performance';
import { ScrollAnimation } from '@/components/scroll-animation';
import { LottieAnimation } from '@/components/lottie';
import { AnimationControls } from '@/components/controls';
import { useState } from 'react';
import './App.css';

function App() {
  const [currentAnimation, setCurrentAnimation] = useState('scroll');

  const renderAnimation = () => {
    switch (currentAnimation) {
      case 'scroll':
        return <ScrollAnimation />;
      case 'lottie':
        return <LottieAnimation />;
      default:
        return <ScrollAnimation />;
    }
  };

  return (
    <Layout>
      <FPSPanel />
      <WebVitalsPanel />
      {renderAnimation()}
      <AnimationControls
        onAnimationChange={setCurrentAnimation}
        currentAnimation={currentAnimation}
      />
    </Layout>
  );
}

export default App;
