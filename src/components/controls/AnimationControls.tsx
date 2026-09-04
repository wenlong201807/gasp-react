import styles from './AnimationControls.module.css';

interface AnimationControlsProps {
  onAnimationChange: (type: string) => void;
  currentAnimation: string;
}

const animations = [
  { id: 'scroll', label: 'Scroll Animation' },
  { id: 'lottie', label: 'Lottie Animation' },
  { id: 'parallax', label: 'Parallax Effect' },
  { id: 'morph', label: 'SVG Morphing' },
];

export function AnimationControls({ onAnimationChange, currentAnimation }: AnimationControlsProps) {
  return (
    <div className={styles.controls}>
      <h3 className={styles.title}>Animation Gallery</h3>
      <div className={styles.buttons}>
        {animations.map((anim) => (
          <button
            key={anim.id}
            onClick={() => onAnimationChange(anim.id)}
            className={`${styles.btn} ${currentAnimation === anim.id ? styles.active : ''}`}
          >
            {anim.label}
          </button>
        ))}
      </div>
    </div>
  );
}
