// frontend/src/components/BottomNav.jsx
import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { FaHome, FaTrophy, FaStore, FaUser, FaCog, FaDice } from 'react-icons/fa';
import { getMarketItems, getLeaderboard, getFeed } from '../api';
import { setCachedData, getCachedData } from '../storage';
import { isIosGlassEnabled } from '../platform/iosGlass.js';

import styles from './BottomNav.module.css';

function BottomNav({ user, activePage, onNavigate }) {
  const iosGlass = isIosGlassEnabled();
  const dockRef = useRef(null);
  const buttonRefs = useRef({});
  const [loupe, setLoupe] = useState(null);
  const [hasNavigationBar, setHasNavigationBar] = useState(false);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);

  useLayoutEffect(() => {
    if (!iosGlass) {
      setLoupe(null);
      return;
    }
    updateLoupe();
  }, [activePage, iosGlass]);

  useEffect(() => {
    if (!iosGlass) {
      return undefined;
    }
    function handleResize() {
      updateLoupe();
    }
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [activePage, iosGlass]);

  function updateLoupe() {
    const dock = dockRef.current;
    const button = buttonRefs.current[activePage];
    if (!dock || !button) {
      return;
    }
    const dockRect = dock.getBoundingClientRect();
    const btnRect = button.getBoundingClientRect();
    const padX = 6;
    const padY = 4;
    setLoupe({
      left: btnRect.left - dockRect.left + padX,
      top: btnRect.top - dockRect.top + padY,
      width: Math.max(0, btnRect.width - padX * 2),
      height: Math.max(0, btnRect.height - padY * 2),
    });
  }

  useEffect(() => {
    const checkNavigationBar = () => {
      let navigationBarVisible = false;

      if (window.visualViewport) {
        const viewportHeight = window.visualViewport.height;
        const windowHeight = window.innerHeight;
        const threshold = 30;
        navigationBarVisible = (windowHeight - viewportHeight) > threshold;
      } else {
        const testEl = document.createElement('div');
        testEl.style.position = 'fixed';
        testEl.style.bottom = '0';
        testEl.style.left = '-9999px';
        testEl.style.paddingBottom = 'env(safe-area-inset-bottom)';
        document.body.appendChild(testEl);
        const computedStyle = window.getComputedStyle(testEl);
        const paddingBottom = parseFloat(computedStyle.paddingBottom) || 0;
        document.body.removeChild(testEl);
        navigationBarVisible = paddingBottom > 5;
      }

      setHasNavigationBar(navigationBarVisible);
    };

    const initialCheck = setTimeout(checkNavigationBar, 100);

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', checkNavigationBar);
      window.visualViewport.addEventListener('scroll', checkNavigationBar);
    }

    window.addEventListener('resize', checkNavigationBar);
    const intervalId = setInterval(checkNavigationBar, 300);

    return () => {
      clearTimeout(initialCheck);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', checkNavigationBar);
        window.visualViewport.removeEventListener('scroll', checkNavigationBar);
      }
      window.removeEventListener('resize', checkNavigationBar);
      clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    const handleViewportChange = () => {
      if (window.visualViewport) {
        const viewportHeight = window.visualViewport.height;
        const windowHeight = window.innerHeight;
        const keyboardThreshold = 150;
        const keyboardVisible = (windowHeight - viewportHeight) > keyboardThreshold;
        setIsKeyboardVisible(keyboardVisible);
      }
    };

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleViewportChange);
      window.visualViewport.addEventListener('scroll', handleViewportChange);
    }

    window.addEventListener('resize', handleViewportChange);

    return () => {
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handleViewportChange);
        window.visualViewport.removeEventListener('scroll', handleViewportChange);
      }
      window.removeEventListener('resize', handleViewportChange);
    };
  }, []);

  useEffect(() => {
    const handleFocusIn = (e) => {
      const target = e.target;
      if (
        target.tagName === 'INPUT'
        || target.tagName === 'TEXTAREA'
        || target.contentEditable === 'true'
      ) {
        setIsKeyboardVisible(true);
      }
    };

    const handleFocusOut = () => {
      setTimeout(() => {
        if (window.visualViewport) {
          const viewportHeight = window.visualViewport.height;
          const windowHeight = window.innerHeight;
          const keyboardThreshold = 150;
          const keyboardVisible = (windowHeight - viewportHeight) > keyboardThreshold;
          setIsKeyboardVisible(keyboardVisible);
        }
      }, 100);
    };

    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('focusout', handleFocusOut);

    return () => {
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('focusout', handleFocusOut);
    };
  }, []);

  const prefetchPageData = (pageId) => {
    switch (pageId) {
      case 'marketplace':
        if (!getCachedData('market')) {
          getMarketItems()
            .then((res) => setCachedData('market', res.data))
            .catch((err) => console.warn('Prefetch market failed:', err));
        }
        break;
      case 'leaderboard':
        if (!getCachedData('leaderboard')) {
          getLeaderboard({ period: 'current_month', type: 'received' })
            .then((res) => setCachedData('leaderboard', res.data))
            .catch((err) => console.warn('Prefetch leaderboard failed:', err));
        }
        break;
      case 'home':
        if (!getCachedData('feed')) {
          getFeed()
            .then((res) => setCachedData('feed', res.data))
            .catch((err) => console.warn('Prefetch feed failed:', err));
        }
        break;
      default:
        break;
    }
  };

  const handleNavInteraction = (pageId) => {
    prefetchPageData(pageId);
  };

  const navItems = [
    { id: 'home', label: 'Лента', icon: <FaHome size={22} /> },
    { id: 'leaderboard', label: 'Рейтинг', icon: <FaTrophy size={22} /> },
    { id: 'roulette', label: 'Рулетка', icon: <FaDice size={22} /> },
    { id: 'marketplace', label: 'Магазин', icon: <FaStore size={22} /> },
    { id: 'profile', label: 'Профиль', icon: <FaUser size={22} /> },
  ];

  if (user && user.is_admin) {
    navItems.push({ id: 'admin', label: 'Админ', icon: <FaCog size={22} /> });
  }

  const navClassName = [
    styles.nav,
    iosGlass ? styles.navIos : '',
    isKeyboardVisible ? styles.hidden : '',
  ].filter(Boolean).join(' ');

  const dockPaddingBottom = iosGlass
    ? undefined
    : (hasNavigationBar ? 'calc(15px + env(safe-area-inset-bottom))' : '15px');

  return (
    <nav
      className={navClassName}
      style={dockPaddingBottom ? { paddingBottom: dockPaddingBottom } : undefined}
      aria-label="Основная навигация"
    >
      <div ref={dockRef} className={iosGlass ? styles.iosDock : styles.dockFlat}>
        {iosGlass && loupe && (
          <span
            className={styles.loupe}
            aria-hidden="true"
            style={{
              transform: `translate3d(${loupe.left}px, ${loupe.top}px, 0)`,
              width: loupe.width,
              height: loupe.height,
            }}
          />
        )}
        {navItems.map((item) => (
          <button
            key={item.id}
            type="button"
            ref={(node) => {
              buttonRefs.current[item.id] = node;
            }}
            onClick={() => onNavigate(item.id)}
            onMouseEnter={() => handleNavInteraction(item.id)}
            onTouchStart={() => handleNavInteraction(item.id)}
            className={`${styles.navButton} ${activePage === item.id ? styles.active : ''}`}
            aria-current={activePage === item.id ? 'page' : undefined}
          >
            {item.icon}
            <span className={styles.navLabel}>{item.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}

export default BottomNav;
