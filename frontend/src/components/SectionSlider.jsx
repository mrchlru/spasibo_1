import React, { useCallback, useState } from 'react';
import styles from './SectionSlider.module.css';

import { resolveMediaUrl } from '../utils/resolveMediaUrl';

const MUG_KNOB_ASSET = resolveMediaUrl('/assets/slider/mug-knob.avif');

const SECTIONS = [
  { id: 'feed', label: 'Лента' },
  { id: 'rating', label: 'Рейтинг' },
];

/**
 * Переключатель «Лента / Рейтинг» для мобильной главной.
 *
 * @param {{ activeSection: 'feed' | 'rating', onChange: (section: 'feed' | 'rating') => void }} props
 */
function SectionSlider({ activeSection, onChange }) {
  const isRating = activeSection === 'rating';
  const [knobRotation, setKnobRotation] = useState(0);
  const [sweepDirection, setSweepDirection] = useState('right');
  const [sweepKey, setSweepKey] = useState(0);

  const selectSection = useCallback(
    (section) => {
      if (section === activeSection) {
        return;
      }

      const toRating = section === 'rating';
      setKnobRotation((prev) => prev + (toRating ? 360 : -360));
      setSweepDirection(toRating ? 'right' : 'left');
      setSweepKey((prev) => prev + 1);
      onChange(section);
    },
    [activeSection, onChange],
  );

  return (
    <div className={styles.wrapper} data-tour-anchor="feed-section">
      <div className={styles.track} role="tablist" aria-label="Разделы ленты">
        <div className={styles.well}>
          <div
            className={`${styles.activeGlow} ${isRating ? styles.activeGlowRight : styles.activeGlowLeft}`}
            aria-hidden="true"
          />

          <div
            key={sweepKey}
            className={`${styles.switchSweep} ${sweepDirection === 'right' ? styles.sweepRight : styles.sweepLeft}`}
            aria-hidden="true"
          />

          <div className={`${styles.labels} ${isRating ? styles.labelsRating : styles.labelsFeed}`}>
            {SECTIONS.map((section) => (
              <button
                key={section.id}
                type="button"
                role="tab"
                aria-selected={activeSection === section.id}
                className={`${styles.labelBtn} ${activeSection === section.id ? styles.labelActive : ''}`}
                onClick={() => selectSection(section.id)}
              >
                {section.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            className={`${styles.knob} ${isRating ? styles.knobRight : styles.knobLeft}`}
            onClick={() => selectSection(isRating ? 'feed' : 'rating')}
            aria-label={isRating ? 'Переключить на ленту' : 'Переключить на рейтинг'}
          >
            <span className={styles.knobAura} aria-hidden="true" />
            <span className={styles.knobWrap} style={{ transform: `rotate(${knobRotation}deg)` }}>
              <img src={MUG_KNOB_ASSET} alt="" className={styles.knobImg} draggable={false} />
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default SectionSlider;
