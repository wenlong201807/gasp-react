import { ReactNode } from 'react';
import styles from './Layout.module.css';

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  return (
    <div className={styles.layout}>
      <header className={styles.header}>
        <nav className={styles.nav}>
          <div className={styles.logo}>GSAP React</div>
          <ul className={styles.menu}>
            <li><a href="#fps">FPS</a></li>
            <li><a href="#vitals">Vitals</a></li>
            <li><a href="#scroll">Scroll</a></li>
            <li><a href="#lottie">Lottie</a></li>
          </ul>
        </nav>
      </header>
      <main className={styles.main}>{children}</main>
      <footer className={styles.footer}>
        <p>Built with React 18, Vite, GSAP & Lottie</p>
      </footer>
    </div>
  );
}
