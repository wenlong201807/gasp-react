import { useRef, useEffect, useState } from 'react';
import Lottie, { LottieRefCurrentProps } from 'lottie-react';
import animationData from '@/assets/loading.json';
import styles from './LottieAnimation.module.css';

export function LottieAnimation() {
  const lottieRef = useRef<LottieRefCurrentProps>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (lottieRef.current) {
      lottieRef.current.setSpeed(1);
    }
  }, []);

  const handlePlay = () => {
    lottieRef.current?.play();
    setIsPlaying(true);
  };

  const handlePause = () => {
    lottieRef.current?.pause();
    setIsPlaying(false);
  };

  const handleStop = () => {
    lottieRef.current?.stop();
    setIsPlaying(false);
    setProgress(0);
  };

  const handleProgressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value);
    if (lottieRef.current) {
      const totalFrames = lottieRef.current.getDuration(true) || 100;
      lottieRef.current.goToAndStop((value / 100) * totalFrames, true);
      setProgress(value);
    }
  };

  return (
    <div className={styles.container}>
      <h2 className={styles.title}>Lottie Animation</h2>

      <div className={styles.animationWrapper}>
        <Lottie
          lottieRef={lottieRef}
          animationData={animationData}
          loop
          autoplay
          style={{ width: 200, height: 200 }}
          onComplete={() => setIsPlaying(false)}
        />
      </div>

      <div className={styles.controls}>
        <button onClick={handlePlay} disabled={isPlaying} className={styles.btn}>
          ▶ Play
        </button>
        <button onClick={handlePause} disabled={!isPlaying} className={styles.btn}>
          ⏸ Pause
        </button>
        <button onClick={handleStop} className={styles.btn}>
          ⏹ Stop
        </button>
      </div>

      <div className={styles.progressControl}>
        <span>Progress: {progress.toFixed(0)}%</span>
        <input
          type="range"
          min="0"
          max="100"
          value={progress}
          onChange={handleProgressChange}
          className={styles.slider}
        />
      </div>
    </div>
  );
}
