import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styles from './NewYearGiftPage.module.css';
import {
  fetchAuthedMediaUrl,
  getNyGift,
  getNyState,
  getNyWall,
  openNyGift,
  uploadNyPhoto,
} from '../api';
import { compressImageForNyUpload } from '../utils/nyImageCompress';
import { openExternalLink } from '../utils/openExternalLink';
import { useModalAlert } from '../contexts/ModalAlertContext';

/**
 * Склонение «раз/раза/раз».
 *
 * @param {number} n
 * @returns {string}
 */
function pluralRaz(n) {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return 'раз';
  if (last === 1) return 'раз';
  if (last >= 2 && last <= 4) return 'раза';
  return 'раз';
}

/**
 * Стабильный «рандом» от id — без Math.random в рендере.
 *
 * @param {number|string} seed
 * @returns {number} 0..1
 */
function unitFromSeed(seed) {
  const text = String(seed ?? '');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

/**
 * Приводит detail API к строке для UI.
 *
 * @param {unknown} detail
 * @param {string} fallback
 * @returns {string}
 */
function detailToMessage(detail, fallback) {
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (detail && typeof detail === 'object') {
    if (typeof detail.message === 'string' && detail.message.trim()) return detail.message;
    if (typeof detail.detail === 'string' && detail.detail.trim()) return detail.detail;
  }
  return fallback;
}

/**
 * Экран новогоднего подарка: фото → тапы → сертификат → стена.
 *
 * @param {{ onBack: () => void, initialOpenGift?: boolean }} props
 */
function NewYearGiftPage({ onBack, initialOpenGift = false }) {
  const { showAlert } = useModalAlert();
  const reduceMotion = useMemo(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  const [loading, setLoading] = useState(true);
  const [stateInfo, setStateInfo] = useState(null);
  const [phase, setPhase] = useState('not_started');
  const [taps, setTaps] = useState(0);
  const [tapsRequired, setTapsRequired] = useState(7);
  const [hint, setHint] = useState('Загрузи новогоднее фото — и сможешь открыть подарок');
  const [gift, setGift] = useState(null);
  const [giftImageUrl, setGiftImageUrl] = useState('');
  const [showCert, setShowCert] = useState(false);
  const [wallItems, setWallItems] = useState([]);
  const [wallSeed, setWallSeed] = useState('');
  const [wallCursor, setWallCursor] = useState(0);
  const [wallHasMore, setWallHasMore] = useState(false);
  const [thumbUrls, setThumbUrls] = useState({});
  const [lightbox, setLightbox] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [opening, setOpening] = useState(false);
  const [errorCard, setErrorCard] = useState(null);
  const [noStock, setNoStock] = useState(false);

  const canvasRef = useRef(null);
  const giftSvgRef = useRef(null);
  const lidRef = useRef(null);
  const raysRef = useRef(null);
  const haloRef = useRef(null);
  const leakRef = useRef(null);
  const flashRef = useRef(null);
  const fileRef = useRef(null);
  const particlesRef = useRef([]);
  const snowRef = useRef([]);
  const blobUrlsRef = useRef([]);
  const hitLockRef = useRef(false);

  const rememberBlob = useCallback((url) => {
    if (url) blobUrlsRef.current.push(url);
    return url;
  }, []);

  useEffect(() => {
    return () => {
      blobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  const loadGiftCard = useCallback(async () => {
    const response = await getNyGift();
    const data = response.data;
    setGift(data);
    try {
      const url = rememberBlob(await fetchAuthedMediaUrl('/ny/gift/image'));
      setGiftImageUrl(url);
    } catch {
      setGiftImageUrl('');
    }
    return data;
  }, [rememberBlob]);

  const wallCursorRef = useRef(0);
  const wallSeedRef = useRef('');

  const loadWall = useCallback(
    async ({ reset = false, seed } = {}) => {
      const response = await getNyWall({
        cursor: reset ? 0 : wallCursorRef.current,
        limit: 48,
        seed: seed || wallSeedRef.current || undefined,
      });
      const data = response.data;
      const pageItems = Array.isArray(data?.items) ? data.items : [];
      wallSeedRef.current = data?.seed || '';
      wallCursorRef.current = data?.cursor || 0;
      setWallSeed(wallSeedRef.current);
      setWallHasMore(Boolean(data?.has_more));
      setWallCursor(wallCursorRef.current);
      setWallItems((prev) => (reset ? pageItems : [...prev, ...pageItems]));

      const nextThumbs = {};
      await Promise.all(
        pageItems.map(async (item) => {
          try {
            nextThumbs[item.user_id] = rememberBlob(await fetchAuthedMediaUrl(item.thumb_url));
          } catch {
            /* ignore */
          }
        }),
      );
      setThumbUrls((prev) => (reset ? nextThumbs : { ...prev, ...nextThumbs }));
    },
    [rememberBlob],
  );

  const bootstrap = useCallback(async () => {
    setLoading(true);
    setErrorCard(null);
    try {
      const response = await getNyState();
      const data = response.data;
      setStateInfo(data);
      setTapsRequired(data.taps_required || 7);
      const userState = data.user_state || 'not_started';
      if (userState === 'gift_opened') {
        setPhase('done');
        setHint(`Участников: ${data.participants_count || 0}. Нажми на фото, чтобы рассмотреть`);
        await loadGiftCard();
        await loadWall({ reset: true });
        if (initialOpenGift) {
          setShowCert(true);
          window.__nyOpenGift = false;
        }
      } else if (userState === 'photo_uploaded') {
        setPhase('photo_uploaded');
        setHint(`Нажимай на подарок! Осталось нажать: ${data.taps_required || 7} раз`);
        await loadWall({ reset: true });
      } else {
        setPhase('not_started');
        setHint('Загрузи новогоднее фото — и сможешь открыть подарок');
        await loadWall({ reset: true });
      }
    } catch (error) {
      setErrorCard({
        message: detailToMessage(error.response?.data?.detail, 'Не удалось загрузить ивент'),
        retry: bootstrap,
      });
    } finally {
      setLoading(false);
    }
  }, [initialOpenGift, loadGiftCard, loadWall]);

  useEffect(() => {
    void bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    let frame = 0;
    let width = 0;
    let height = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let ro = null;

    function size() {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      // setTransform(a, b, c, d, e, f) — нужны все 6 чисел, иначе Chromium падает с DOMMatrixInit.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    size();
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(size);
      ro.observe(canvas);
    } else {
      window.addEventListener('resize', size);
    }

    snowRef.current = reduceMotion
      ? []
      : Array.from({ length: 45 }, () => ({
          x: Math.random() * 400,
          y: Math.random() * 820,
          r: 1 + Math.random() * 2.5,
          v: 0.3 + Math.random() * 0.8,
          p: Math.random() * 6,
        }));

    function tick() {
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#fff';
      ctx.globalAlpha = 0.75;
      for (const flake of snowRef.current) {
        flake.y += flake.v;
        flake.p += 0.02;
        flake.x += Math.sin(flake.p) * 0.4;
        if (flake.y > height + 5) {
          flake.y = -5;
          flake.x = Math.random() * width;
        }
        ctx.beginPath();
        ctx.arc((flake.x * width) / 400, flake.y, flake.r, 0, 6.3);
        ctx.fill();
      }
      for (const p of particlesRef.current) {
        p.vy += p.g;
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.985;
        p.life -= p.d;
        p.r += 0.2;
        ctx.globalAlpha = Math.max(p.life, 0);
        ctx.fillStyle = p.c;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.r);
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      particlesRef.current = particlesRef.current.filter((p) => p.life > 0 && p.y < height + 20);
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      if (ro) {
        ro.disconnect();
      } else {
        window.removeEventListener('resize', size);
      }
    };
  }, [reduceMotion]);

  function burst(n, cx, cy, kind) {
    const cols = ['#ffd86b', '#ff5a5a', '#7be08a', '#fff', '#6ec6ff'];
    for (let i = 0; i < n; i += 1) {
      const a = Math.random() * 6.28;
      const s = kind === 'spark' ? 2 + Math.random() * 4 : 4 + Math.random() * 9;
      particlesRef.current.push({
        x: cx,
        y: cy,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - (kind === 'spark' ? 1 : 5),
        life: 1,
        d: kind === 'spark' ? 0.03 : 0.008 + Math.random() * 0.01,
        c: kind === 'spark' ? '#ffe28a' : cols[i % 5],
        w: kind === 'spark' ? 2.5 : 5 + Math.random() * 5,
        h: kind === 'spark' ? 2.5 : 3 + Math.random() * 4,
        r: Math.random() * 6,
        g: kind === 'spark' ? 0.12 : 0.22,
      });
    }
  }

  function stageCenter() {
    const stage = document.getElementById('ny-stage');
    const canvas = canvasRef.current;
    if (!stage || !canvas) return [160, 200];
    const a = stage.getBoundingClientRect();
    const b = canvas.getBoundingClientRect();
    return [a.left - b.left + a.width / 2, a.top - b.top + a.height / 2];
  }

  async function handleUpload(file) {
    if (!file) return;
    const ok = window.confirm('Твоё фото увидят коллеги в приложении. Продолжить?');
    if (!ok) return;
    setUploading(true);
    setErrorCard(null);
    try {
      const compressed = await compressImageForNyUpload(file);
      await uploadNyPhoto(compressed);
      setPhase('photo_uploaded');
      setTaps(0);
      setHint(`Нажимай на подарок! Осталось нажать: ${tapsRequired} раз`);
      await loadWall({ reset: true });
      showAlert('Фото загружено! Нажимай на подарок.', 'success');
    } catch (error) {
      const detail = error.response?.data?.detail || 'Не удалось загрузить фото';
      showAlert(typeof detail === 'string' ? detail : 'Не удалось загрузить фото', 'error');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function playOpenAnimation(cx, cy, giftData) {
    setPhase('opening');
    setHint('Ура! Подарок открывается…');
    const flash = flashRef.current;
    const lid = lidRef.current;
    const giftSvg = giftSvgRef.current;
    const rays = raysRef.current;
    if (flash) {
      flash.animate([{ opacity: 0 }, { opacity: 0.95, offset: 0.15 }, { opacity: 0 }], {
        duration: 700,
      });
    }
    if (lid) {
      lid.animate(
        [
          { transform: 'translate(0,0) rotate(0)', opacity: 1 },
          { transform: 'translate(30px,-330px) rotate(28deg)', opacity: 0 },
        ],
        { duration: 900, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'forwards' },
      );
    }
    if (giftSvg) {
      giftSvg.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(1.15,.85)', offset: 0.2 }, { transform: 'scale(1)' }],
        { duration: 500 },
      );
    }
    if (rays) {
      rays.animate(
        [
          { opacity: 0, transform: 'rotate(0) scale(.3)' },
          { opacity: 0.9, offset: 0.3 },
          { opacity: 0.55, transform: 'rotate(80deg) scale(1)' },
        ],
        { duration: 4000, fill: 'forwards', easing: 'ease-out' },
      );
    }
    if (haloRef.current) haloRef.current.style.opacity = '1';
    burst(110, cx, cy - 30, 'conf');
    burst(40, cx, cy - 30, 'spark');
    setTimeout(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      burst(60, canvas.clientWidth * 0.2, canvas.clientHeight * 0.5, 'conf');
      burst(60, canvas.clientWidth * 0.8, canvas.clientHeight * 0.5, 'conf');
    }, 350);

    setGift(giftData);
    try {
      const url = rememberBlob(await fetchAuthedMediaUrl('/ny/gift/image'));
      setGiftImageUrl(url);
    } catch {
      setGiftImageUrl('');
    }

    setTimeout(() => {
      setShowCert(true);
      setPhase('gift_opened');
      setHint('Это твой подарок! Он сохранён в профиле');
      if (giftSvg) {
        giftSvg.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 600, fill: 'forwards' });
      }
    }, 800);
  }

  async function requestGift(cx, cy) {
    setOpening(true);
    setErrorCard(null);
    setHint('Ура! Подарок открывается…');
    const giftSvg = giftSvgRef.current;
    if (giftSvg && !reduceMotion) {
      giftSvg.animate(
        [
          { transform: 'scale(1)' },
          { transform: 'scale(1.08,0.9) rotate(-4deg)', offset: 0.3 },
          { transform: 'scale(0.96,1.04) rotate(4deg)', offset: 0.7 },
          { transform: 'scale(1)' },
        ],
        { duration: 600, iterations: 1 },
      );
    }
    try {
      const response = await openNyGift();
      await playOpenAnimation(cx, cy, response.data);
    } catch (error) {
      const detail = error.response?.data?.detail;
      const code = detail?.code || (typeof detail === 'object' ? detail.code : null);
      if (error.response?.status === 409 && (code === 'NO_STOCK' || String(detail).includes('закончились'))) {
        setNoStock(true);
        setPhase('done');
        setHint('Подарки закончились. Твоё фото останется на стене коллег');
        await loadWall({ reset: true });
      } else {
        setErrorCard({
          message: detailToMessage(detail, 'Не удалось открыть подарок. Попробуй ещё раз.'),
          retry: () => requestGift(cx, cy),
        });
        setPhase('photo_uploaded');
        setHint(`Нажимай на подарок! Осталось нажать: 1 ${pluralRaz(1)}`);
        setTaps(Math.max(0, tapsRequired - 1));
      }
    } finally {
      setOpening(false);
      hitLockRef.current = false;
    }
  }

  function handleHit() {
    if (phase !== 'photo_uploaded' || hitLockRef.current || opening) return;
    const next = taps + 1;
    setTaps(next);
    const ratio = next / tapsRequired;
    const [cx, cy] = stageCenter();
    if (haloRef.current) haloRef.current.style.opacity = String(ratio * 0.9);
    if (leakRef.current) leakRef.current.setAttribute('opacity', String(ratio));
    if (navigator.vibrate) navigator.vibrate(next < tapsRequired ? 15 + next * 8 : 80);

    const giftSvg = giftSvgRef.current;
    if (next < tapsRequired) {
      const amp = 4 + next * 3;
      if (giftSvg) {
        giftSvg.getAnimations?.().forEach((a) => a.cancel());
        giftSvg.animate(
          [
            { transform: 'scale(1)' },
            {
              transform: `scale(${1.08 + ratio * 0.05},${0.88 - ratio * 0.04}) rotate(${-amp / 2}deg)`,
              offset: 0.25,
            },
            { transform: `scale(.97,1.04) rotate(${amp / 2}deg)`, offset: 0.5 },
            { transform: `translateX(${amp / 3}px) rotate(${-amp / 4}deg)`, offset: 0.75 },
            { transform: 'scale(1)' },
          ],
          { duration: 420 + next * 20, easing: 'ease-out' },
        );
      }
      burst(8 + next * 3, cx, cy - 20, 'spark');
      const left = tapsRequired - next;
      setHint(
        left === tapsRequired - 1
          ? `Нажимай на подарок! Осталось нажать: ${left} ${pluralRaz(left)}`
          : `Отлично! Осталось нажать: ${left} ${pluralRaz(left)}`,
      );
      return;
    }

    hitLockRef.current = true;
    void requestGift(cx, cy);
  }

  async function openLightbox(item) {
    try {
      const url = rememberBlob(await fetchAuthedMediaUrl(item.photo_url));
      setLightbox({ ...item, fullUrl: url });
    } catch {
      showAlert('Не удалось открыть фото', 'error');
    }
  }

  async function saveGiftImage() {
    if (!giftImageUrl) {
      showAlert('Картинка ещё не загружена', 'error');
      return;
    }
    try {
      const anchor = document.createElement('a');
      anchor.href = giftImageUrl;
      anchor.download = 'novogodniy-podarok.jpg';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      showAlert('Картинка сохранена', 'success');
    } catch {
      showAlert('Не удалось сохранить картинку', 'error');
    }
  }

  function copyLink() {
    if (!gift?.link_url) return;
    navigator.clipboard?.writeText(gift.link_url).then(
      () => showAlert('Ссылка скопирована', 'success'),
      () => showAlert('Не удалось скопировать', 'error'),
    );
  }

  const rootClass = [
    styles.page,
    phase === 'photo_uploaded' || phase === 'opening' ? styles.ready : '',
    phase === 'gift_opened' || phase === 'done' ? styles.opened : '',
    phase === 'done' ? styles.done : '',
  ]
    .filter(Boolean)
    .join(' ');

  const stepIndex =
    phase === 'not_started' ? 0 : phase === 'photo_uploaded' || phase === 'opening' ? 1 : 2;

  const wallPositions = useMemo(() => {
    const items = Array.isArray(wallItems) ? wallItems : [];
    const ww = typeof window !== 'undefined' ? window.innerWidth : 400;
    const hh = typeof window !== 'undefined' ? window.innerHeight : 820;
    const pw = phase === 'done' ? 92 : 76;
    const cardH = pw + 18;
    const cols = 4;
    const rows = Math.max(1, Math.ceil(items.length / cols));
    const cw = cols > 1 ? (ww - pw) / (cols - 1) : 0;
    const ch = Math.max(cardH, (hh - 170 - cardH - 40) / rows);
    return items.map((item, i) => {
      const jitterX = unitFromSeed(`${item.user_id}-x`) - 0.5;
      const jitterY = unitFromSeed(`${item.user_id}-y`);
      const rot = Math.round(unitFromSeed(`${item.user_id}-r`) * 28 - 14);
      const x = Math.max(0, Math.min(ww - pw, (i % cols) * cw + jitterX * cw * 0.5));
      const y = 170 + Math.floor(i / cols) * ch + jitterY * Math.max(0, ch - cardH);
      return {
        ...item,
        style: {
          left: x,
          top: y,
          '--r': `${rot}deg`,
          '--d': `${i * 40}ms`,
        },
      };
    });
  }, [wallItems, phase]);

  return (
    <div className={rootClass} id="ny-root">
      <button type="button" className={styles.back} onClick={onBack} aria-label="Назад">
        ‹
      </button>
      <div className={styles.title}>
        <h2>{phase === 'done' ? 'Фото коллег' : 'Новогодний подарок'}</h2>
        <p>{hint}</p>
      </div>

      <div className={styles.wall}>
        {wallPositions.map((item) => (
          <button
            type="button"
            key={item.user_id}
            className={`${styles.wp}${item.is_me ? ` ${styles.wpMe}` : ''}`}
            style={item.style}
            onClick={() => openLightbox(item)}
          >
            {thumbUrls[item.user_id] ? (
              <img className={styles.wpImg} src={thumbUrls[item.user_id]} alt="" loading="lazy" />
            ) : (
              <div className={styles.wpImg} />
            )}
            {item.display_name}
          </button>
        ))}
      </div>

      {wallHasMore && phase === 'done' ? (
        <button
          type="button"
          className={`${styles.btn} ${styles.btnGhost} ${styles.moreWall}`}
          onClick={() => loadWall({ reset: false })}
        >
          Показать другие
        </button>
      ) : null}

      <div className={styles.lb + (lightbox ? ` ${styles.lbOn}` : '')} onClick={() => setLightbox(null)}>
        {lightbox ? (
          <div className={styles.lbCard} onClick={(e) => e.stopPropagation()}>
            <img src={lightbox.fullUrl} alt="" />
            {lightbox.display_name}
          </div>
        ) : null}
      </div>

      <button
        type="button"
        className={`${styles.btn} ${styles.mygift}`}
        onClick={() => {
          if (noStock) {
            showAlert('Подарок не был выдан — сертификаты закончились', 'error');
            return;
          }
          setShowCert(true);
        }}
      >
        🎁 Мой подарок
      </button>

      <div className={styles.stage} id="ny-stage">
        <div className={styles.rays} ref={raysRef} />
        <div className={styles.tapme}>
          👆<span>Нажимай!</span>
        </div>
        <div className={styles.halo} ref={haloRef} />
        <svg
          className={styles.giftSvg}
          ref={giftSvgRef}
          viewBox="0 0 240 240"
          role="button"
          aria-label="Подарок"
          onPointerDown={handleHit}
        >
          <defs>
            <linearGradient id="ny-rd" x1="0" x2="1">
              <stop offset="0" stopColor="#a81f2b" />
              <stop offset=".5" stopColor="#e8484a" />
              <stop offset="1" stopColor="#9c1a26" />
            </linearGradient>
            <linearGradient id="ny-rl" x1="0" x2="1">
              <stop offset="0" stopColor="#c22d36" />
              <stop offset=".5" stopColor="#ff6a62" />
              <stop offset="1" stopColor="#b52530" />
            </linearGradient>
            <linearGradient id="ny-gd" x1="0" x2="1">
              <stop offset="0" stopColor="#e0a21f" />
              <stop offset=".5" stopColor="#fff0a0" />
              <stop offset="1" stopColor="#d9981a" />
            </linearGradient>
          </defs>
          <ellipse cx="120" cy="224" rx="92" ry="11" fill="#0007" />
          <rect x="42" y="112" width="156" height="108" rx="10" fill="url(#ny-rd)" />
          <rect x="108" y="112" width="24" height="108" fill="url(#ny-gd)" />
          <rect
            ref={leakRef}
            x="46"
            y="108"
            width="148"
            height="10"
            fill="#fff3b0"
            opacity="0"
          />
          <g ref={lidRef}>
            <rect x="30" y="76" width="180" height="40" rx="9" fill="url(#ny-rl)" />
            <rect x="108" y="76" width="24" height="40" fill="url(#ny-gd)" />
            <path d="M120 76C84 24 52 52 120 76Z" fill="url(#ny-gd)" />
            <path d="M120 76C156 24 188 52 120 76Z" fill="url(#ny-gd)" />
            <path d="M120 76C96 44 78 54 120 76Z" fill="#c98712" opacity=".5" />
            <circle cx="120" cy="74" r="9" fill="url(#ny-gd)" />
            <rect x="36" y="80" width="168" height="5" rx="3" fill="#fff" opacity=".25" />
          </g>
        </svg>
      </div>

      {showCert && gift ? (
        <div className={styles.cert}>
          <span className={styles.certClose} onClick={() => setShowCert(false)} role="button">
            ×
          </span>
          <small>{gift.title || 'Твой подарок'}</small>
          {gift.nominal ? <h3>{gift.nominal}</h3> : <h3>Сертификат</h3>}
          {giftImageUrl ? <img className={styles.certImg} src={giftImageUrl} alt="Сертификат" /> : null}
          <button
            type="button"
            className={styles.cbtn}
            onClick={() => gift.link_url && openExternalLink(gift.link_url)}
          >
            Открыть сертификат
          </button>
          <button type="button" className={`${styles.cbtn} ${styles.cbtnSecondary}`} onClick={saveGiftImage}>
            Сохранить картинку
          </button>
          <button type="button" className={`${styles.cbtn} ${styles.cbtnSecondary}`} onClick={copyLink}>
            Скопировать ссылку
          </button>
          {phase === 'gift_opened' ? (
            <button
              type="button"
              className={`${styles.cbtn} ${styles.cbtnSecondary}`}
              onClick={async () => {
                setShowCert(false);
                setPhase('done');
                setHint(
                  `Участников: ${stateInfo?.participants_count || wallItems.length}. Нажми на фото, чтобы рассмотреть`,
                );
                await loadWall({ reset: true });
              }}
            >
              Смотреть стену фото
            </button>
          ) : null}
        </div>
      ) : null}

      <div className={styles.bottom}>
        <ol className={styles.steps}>
          <li className={stepIndex === 0 ? styles.stepOn : ''}>
            <b>1</b>Загрузи новогоднее фото
          </li>
          <li className={stepIndex === 1 ? styles.stepOn : ''}>
            <b>2</b>Нажимай на подарок {tapsRequired} раз
          </li>
          <li className={stepIndex === 2 ? styles.stepOn : ''}>
            <b>3</b>Получи подарок
          </li>
        </ol>
        <div className={styles.pips}>
          {Array.from({ length: Math.max(1, Math.min(Number(tapsRequired) || 7, 50)) }, (_, i) => (
            <u key={i} className={`${styles.pip}${i < taps ? ` ${styles.pipFilled}` : ''}`} />
          ))}
        </div>
        {phase === 'not_started' ? (
          <button
            type="button"
            className={styles.btn}
            disabled={uploading || loading}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? 'Загрузка…' : 'Загрузить фото'}
          </button>
        ) : null}
        {noStock ? (
          <button type="button" className={styles.btn} onClick={() => setPhase('done')}>
            Смотреть стену фото
          </button>
        ) : null}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => handleUpload(e.target.files?.[0])}
        />
      </div>

      <canvas className={styles.snow} ref={canvasRef} />
      <div className={styles.flash} ref={flashRef} />

      {errorCard ? (
        <div className={styles.errorBox}>
          <p>{errorCard.message}</p>
          <button type="button" className={styles.btn} onClick={() => errorCard.retry?.()}>
            Повторить
          </button>
        </div>
      ) : null}

      {loading ? (
        <div className={styles.errorBox}>
          <p>Загрузка…</p>
        </div>
      ) : null}
    </div>
  );
}

export default NewYearGiftPage;
