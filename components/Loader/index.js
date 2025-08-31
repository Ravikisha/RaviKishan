import React, { useEffect, useRef } from "react";
import { words } from "./data";
import styles from "./Loader.module.scss";
import { introAnimation, collapseWords, progressAnimation } from "./animations";
import { gsap } from "gsap";

const Loader = ({ onComplete }) => {
  const loaderRef = useRef(null);
  const progressRef = useRef(null);
  const progressNumberRef = useRef(null);
  const wordGroupsRef = useRef(null);

  useEffect(() => {
    const tl = gsap.timeline({
      onComplete: () => {
        if (onComplete) onComplete();
      },
    });

    tl.add(introAnimation(wordGroupsRef))
      .add(progressAnimation(progressRef, progressNumberRef), 0)
      .add(collapseWords(loaderRef), "-=1");
  }, []);

  return (
    <div className={styles.loader__wrapper} style={{ zIndex: 100 }} >
      <div className={styles.loader__progressWrapper}>
        <div className={styles.loader__progress} ref={progressRef}></div>
        <span className={styles.loader__progressNumber} ref={progressNumberRef}>
          0
        </span>
      </div>
      <div className={styles.loader} ref={loaderRef}>
        <div className={styles.loader__words}>
          <div className={styles.loader__overlay}></div>
          <div ref={wordGroupsRef} className={styles.loader__wordsGroup}>
            {words.map((word, index) => (
              <span key={index} className={styles.loader__word}>
                {word}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Loader;
