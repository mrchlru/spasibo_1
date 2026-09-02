// frontend/src/pages/HomePage.jsx

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { FaPen, FaThumbtack, FaEye, FaPencil, FaBullhorn } from 'react-icons/fa6';
import { getFeed, getBanners, publishFeedPost, pinFeedPost, unpinFeedPost, resolveAvatarUrl } from '../api';
import styles from './HomePage.module.css';
import { getCachedData } from '../storage';
import { formatToMsk, formatFeedDate } from '../utils/dateFormatter';
import LeaderboardBanner from '../components/LeaderboardBanner';
import Garland from '../components/Garland';
import FeedPostModal from '../components/FeedPostModal';
import SectionSlider from '../components/SectionSlider';
import LeaderboardContent from '../components/LeaderboardContent';
import { resolveSeasonAssets } from '../themeAssetDefaults';

function normalizeFeedEntries(data) {
  if (!data || !Array.isArray(data)) return [];
  if (data.length > 0 && data[0].kind) return data;
  return data.map((transaction) => ({
    kind: 'transaction',
    timestamp: transaction.timestamp,
    transaction,
  }));
}

function canManageFeedPosts(user) {
  return Boolean(user?.is_admin || user?.can_publish_feed_posts);
}

function canAuthorPinPost(post, user) {
  if (!canManageFeedPosts(user) || !user) return false;
  return post.created_by_user_id === user.id || post.author?.id === user.id;
}

function HomePage({
  user,
  onNavigate,
  telegramPhotoUrl,
  isDesktop,
  seasonTheme,
  themeAssets,
  homeSection = 'feed',
  onHomeSectionChange,
}) {
  const isWinterTheme = seasonTheme === 'winter';
  const seasonKey = isWinterTheme ? 'winter' : 'summer';
  const mergedAssets = useMemo(
    () => resolveSeasonAssets(seasonKey, themeAssets),
    [seasonKey, themeAssets],
  );
  const sendThanksImage = mergedAssets.thanks_button;
  const feedLogoImage = mergedAssets.thanks_feed_logo;
  const [feedEntries, setFeedEntries] = useState(() => normalizeFeedEntries(getCachedData('feed')));
  const [banners, setBanners] = useState(() => getCachedData('banners') || []);
  const [isLoading, setIsLoading] = useState(!feedEntries);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [feedModalOpen, setFeedModalOpen] = useState(false);
  const [editingPost, setEditingPost] = useState(null);
  const autoSlideTimerRef = useRef(null);

  const refreshFeed = useCallback(async () => {
    try {
      const response = await getFeed();
      setFeedEntries(normalizeFeedEntries(response.data));
    } catch (error) {
      console.error('Failed to fetch feed', error);
    }
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      const promises = [];

      if (!banners || banners.length === 0) {
        promises.push(
          getBanners()
            .then((response) => setBanners(response.data))
            .catch((error) => console.error('Failed to fetch banners', error)),
        );
      }

      if (!feedEntries) {
        promises.push(refreshFeed());
      }

      if (promises.length > 0) {
        await Promise.all(promises);
      }

      setIsLoading(false);
    };

    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mainBanners = banners.filter((b) => b.position === 'main');

  const goToNextSlide = () => {
    if (mainBanners.length > 1) {
      if (autoSlideTimerRef.current) clearTimeout(autoSlideTimerRef.current);
      setCurrentSlide((prevSlide) => (prevSlide + 1) % mainBanners.length);
    }
  };

  const goToPrevSlide = () => {
    if (mainBanners.length > 1) {
      if (autoSlideTimerRef.current) clearTimeout(autoSlideTimerRef.current);
      setCurrentSlide((prevSlide) => (prevSlide - 1 + mainBanners.length) % mainBanners.length);
    }
  };

  useEffect(() => {
    if (mainBanners.length > 1) {
      if (autoSlideTimerRef.current) clearTimeout(autoSlideTimerRef.current);
      const timer = setTimeout(() => {
        setCurrentSlide((prevSlide) => (prevSlide + 1) % mainBanners.length);
      }, 5000);
      autoSlideTimerRef.current = timer;
      return () => {
        if (autoSlideTimerRef.current) clearTimeout(autoSlideTimerRef.current);
      };
    }
    return undefined;
  }, [currentSlide, mainBanners.length]);

  const photoFeedBanners = banners.filter((b) => b.position === 'feed');

  const handleBannerClick = (url) => {
    if (!url) return;
    if (url.startsWith('/')) {
      onNavigate(url.replace('/', ''));
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const { pinnedEntries, groupedStream } = useMemo(() => {
    const entries = feedEntries || [];
    const pinned = [];
    const stream = [];

    for (const entry of entries) {
      if (entry.kind === 'post' && entry.post) {
        const mapped = { key: `post-${entry.post.id}`, timestamp: entry.timestamp, post: entry.post };
        if (entry.post.is_pinned) pinned.push(mapped);
        else stream.push(mapped);
        continue;
      }
      if (entry.kind === 'transaction' && entry.transaction) {
        stream.push({
          key: `tx-${entry.transaction.id}`,
          timestamp: entry.timestamp,
          transaction: entry.transaction,
        });
      }
    }

    pinned.sort((a, b) => (b.post?.pin_order || 0) - (a.post?.pin_order || 0));

    const grouped = stream.reduce((acc, item) => {
      const dateKey = formatToMsk(item.timestamp, {
        year: undefined,
        month: undefined,
        day: undefined,
        hour: undefined,
        minute: undefined,
      });
      if (!acc[dateKey]) acc[dateKey] = [];
      acc[dateKey].push(item);
      return acc;
    }, {});

    return { pinnedEntries: pinned, groupedStream: grouped };
  }, [feedEntries]);

  const getSliderTransform = () => {
    if (!isDesktop) {
      return `translateX(-${currentSlide * 100}%)`;
    }
    const slideTotalWidth = 84;
    const initialOffset = 8;
    const offset = initialOffset - currentSlide * slideTotalWidth;
    return `translateX(${offset}%)`;
  };

  async function handleTogglePin(postId, nextPinned) {
    setFeedEntries((prev) =>
      (prev || []).map((entry) => {
        if (entry.kind !== 'post' || entry.post?.id !== postId) return entry;
        return {
          ...entry,
          post: { ...entry.post, is_pinned: nextPinned },
        };
      }),
    );
    try {
      if (nextPinned) await pinFeedPost(postId);
      else await unpinFeedPost(postId);
      await refreshFeed();
    } catch {
      await refreshFeed();
    }
  }

  async function handlePublishPost(postId) {
    try {
      await publishFeedPost(postId);
      await refreshFeed();
    } catch (error) {
      console.error('Failed to publish post', error);
    }
  }

  function openCreateModal() {
    setEditingPost(null);
    setFeedModalOpen(true);
  }

  function openEditModal(post) {
    setEditingPost(post);
    setFeedModalOpen(true);
  }

  function renderPostCard(post) {
    const canPin = canAuthorPinPost(post, user);
    const canEdit = canManageFeedPosts(user);
    const canPublish = canManageFeedPosts(user) && !post.is_published;
    const author = post.author;
    const images = (post.attachments || []).filter((item) => item.kind === 'image');
    const documents = (post.attachments || []).filter((item) => item.kind === 'document');
    const writtenAt = post.published_at || post.created_at;

    return (
      <div
        key={`post-${post.id}`}
        className={`${styles.feedItem} ${styles.feedItemNews} ${post.is_pinned ? styles.feedItemPinned : ''} ${!post.is_published ? styles.feedItemDraft : ''}`}
      >
        <div className={styles.feedPostActions}>
          {canPin && (
            <button
              type="button"
              className={`${styles.feedPostActionBtn} ${post.is_pinned ? styles.feedPostActionActive : ''}`}
              aria-label={post.is_pinned ? 'Открепить' : 'Закрепить'}
              onClick={() => handleTogglePin(post.id, !post.is_pinned)}
            >
              <FaThumbtack size={14} />
            </button>
          )}
          {canPublish && (
            <button
              type="button"
              className={styles.feedPostActionBtn}
              aria-label="Опубликовать для всех"
              onClick={() => handlePublishPost(post.id)}
            >
              <FaEye size={14} />
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              className={styles.feedPostActionBtn}
              aria-label="Редактировать"
              onClick={() => openEditModal(post)}
            >
              <FaPencil size={14} />
            </button>
          )}
        </div>

        <div className={styles.feedNewsHeader}>
          {author ? (
            <img
              src={resolveAvatarUrl(author.telegram_photo_url) || 'placeholder.png'}
              alt=""
              className={styles.feedNewsAvatar}
              loading="lazy"
            />
          ) : (
            <div className={styles.feedItemLogo} aria-hidden="true">
              <FaBullhorn size={18} />
            </div>
          )}
          <div className={styles.feedNewsHeaderContent}>
            {author && <p className={styles.feedAuthorName}>@{author.username || author.first_name || 'Автор'}</p>}
            <p className={styles.feedNewsTitle}>{post.title}</p>
            {!post.is_published && <span className={styles.feedDraftBadge}>Черновик</span>}
          </div>
        </div>

        {post.body && <p className={styles.feedNewsBody}>{post.body}</p>}

        {images.length > 0 && (
          <div className={styles.feedNewsMedia}>
            {images.map((image) => (
              <a key={image.id || image.url} href={image.url} target="_blank" rel="noopener noreferrer">
                <img src={image.url} alt={image.filename || post.title} className={styles.feedNewsImage} loading="lazy" />
              </a>
            ))}
          </div>
        )}

        {documents.length > 0 && (
          <div className={styles.feedNewsDocs}>
            {documents.map((doc) => (
              <a key={doc.id || doc.url} href={doc.url} target="_blank" rel="noopener noreferrer" className={styles.feedDocLink}>
                {doc.filename || 'Скачать файл'}
              </a>
            ))}
          </div>
        )}

        <div className={styles.feedTimestamp}>{formatToMsk(writtenAt, { year: undefined, month: undefined, day: undefined })}</div>
      </div>
    );
  }

  function renderTransactionCard(item) {
    return (
      <div key={`tx-${item.id}`} className={styles.feedItem}>
        <img src={feedLogoImage} alt="feed logo" className={styles.feedItemLogo} loading="lazy" />
        <div className={styles.feedItemContent}>
          <p className={styles.feedTransaction}>
            @{item.sender?.username || item.sender?.first_name || 'Неизвестно'}{' '}
            <span className={styles.arrow}>&rarr;</span>{' '}
            @{item.receiver?.username || item.receiver?.first_name || 'Неизвестно'}
          </p>
          <p className={styles.feedMessage}>{item.amount} спасибо - {item.message}</p>
        </div>
        <div className={styles.feedTimestamp}>
          {formatToMsk(item.timestamp, { year: undefined, month: undefined, day: undefined })}
        </div>
      </div>
    );
  }

  const streamDateKeys = Object.keys(groupedStream);
  const hasFeedContent = pinnedEntries.length > 0 || streamDateKeys.length > 0;
  const isRatingSection = !isDesktop && homeSection === 'rating';

  function handleSectionChange(section) {
    onHomeSectionChange?.(section);
  }

  return (
    <div className={styles.pageContainer}>
      <div className={styles.headerWrapper}>
        <div className={isDesktop ? styles.headerDesktop : styles.header}></div>
      </div>
      <div className={styles.contentArea}>
        <div className={styles.userBlock}>
          {isWinterTheme && <Garland />}
          <img src={telegramPhotoUrl || 'placeholder.png'} alt="User" className={styles.userAvatar} />
          <span className={styles.userName}>{user.first_name}</span>
          <img
            src={sendThanksImage}
            alt="Отправить спасибки"
            className={styles.thankYouButton}
            onClick={() => onNavigate('transfer')}
          />
        </div>

        {!isDesktop && (
          <SectionSlider activeSection={homeSection} onChange={handleSectionChange} />
        )}

        {mainBanners.length > 0 && (
          <div className={styles.sliderContainer}>
            {mainBanners.length > 1 && (
              <button className={styles.sliderArrowLeft} onClick={goToPrevSlide} aria-label="Предыдущий баннер">
                &#8249;
              </button>
            )}

            <div className={styles.sliderTrack} style={{ transform: getSliderTransform() }}>
              {mainBanners.map((banner, index) => (
                <div
                  key={banner.id}
                  className={`${styles.slide} ${currentSlide === index ? styles.active : ''}`}
                  onClick={() => (banner.banner_type === 'image' || !banner.banner_type) && handleBannerClick(banner.link_url)}
                >
                  {(banner.banner_type === 'image' || !banner.banner_type) ? (
                    <img src={banner.image_url} alt="Banner" className={styles.bannerImage} />
                  ) : (
                    <LeaderboardBanner banner={banner} onNavigate={onNavigate} />
                  )}
                </div>
              ))}
            </div>

            {mainBanners.length > 1 && (
              <button className={styles.sliderArrowRight} onClick={goToNextSlide} aria-label="Следующий баннер">
                &#8250;
              </button>
            )}

            {mainBanners.length > 1 && (
              <div className={styles.sliderDots}>
                {mainBanners.map((_, index) => (
                  <div
                    key={index}
                    className={`${styles.dot} ${currentSlide === index ? styles.dotActive : ''}`}
                    onClick={() => {
                      if (autoSlideTimerRef.current) clearTimeout(autoSlideTimerRef.current);
                      setCurrentSlide(index);
                    }}
                  ></div>
                ))}
              </div>
            )}
          </div>
        )}

        {photoFeedBanners.length > 0 && !isRatingSection && (
          <div className={styles.photoFeed}>
            <div className={styles.photoFeedTrack}>
              {[...photoFeedBanners, ...photoFeedBanners].map((banner, index) => (
                <div key={`${banner.id}-${index}`} className={styles.photoPlaceholder} onClick={() => handleBannerClick(banner.link_url)}>
                  <img src={banner.image_url} alt="Photo feed banner" className={styles.photoFeedImage} loading="lazy" />
                </div>
              ))}
            </div>
          </div>
        )}

        {isRatingSection ? (
          <div className={styles.feedSection}>
            <h3 className={styles.feedTitle}>Рейтинг</h3>
            <LeaderboardContent
              user={user}
              seasonTheme={seasonTheme}
              themeAssets={themeAssets}
              embedded
            />
          </div>
        ) : (
        <div className={styles.feedSection}>
          <h3 className={styles.feedTitle}>Последняя активность</h3>
          <div className={styles.feedGrid}>
            {isLoading ? (
              <p>Загрузка...</p>
            ) : hasFeedContent ? (
              <>
                {pinnedEntries.map((entry) => renderPostCard(entry.post))}
                {streamDateKeys.map((dateKey) => (
                  <React.Fragment key={dateKey}>
                    <div className={styles.dateHeader}>
                      <span>{formatFeedDate(groupedStream[dateKey][0].timestamp)}</span>
                    </div>
                    {groupedStream[dateKey].map((entry) => {
                      if (entry.post) return renderPostCard(entry.post);
                      if (entry.transaction) return renderTransactionCard(entry.transaction);
                      return null;
                    })}
                  </React.Fragment>
                ))}
              </>
            ) : (
              <p>Лента активности пуста.</p>
            )}
          </div>
        </div>
        )}
      </div>

      {canManageFeedPosts(user) && !isRatingSection && (
        <button type="button" className={styles.publishFab} aria-label="Написать новость" onClick={openCreateModal}>
          <FaPen size={18} />
        </button>
      )}

      <FeedPostModal
        isOpen={feedModalOpen}
        editPost={editingPost}
        onClose={() => {
          setFeedModalOpen(false);
          setEditingPost(null);
        }}
        onSuccess={refreshFeed}
      />
    </div>
  );
}

export default HomePage;
