import React, { useState, useEffect, useCallback } from 'react';
import { getLeaderboard, getMyRank, getLeaderboardStatus, resolveAvatarUrl } from '../api';
import styles from '../pages/LeaderboardPage.module.css';
import { FaCrown, FaCalendarDay, FaCalendarAlt, FaGift, FaInfinity } from 'react-icons/fa';
import { resolveSeasonAssets } from '../themeAssetDefaults';

const ALL_TABS = [
  { id: 'all_time_received', label: 'За всё время', icon: <FaInfinity />, params: { period: 'all_time', type: 'received' } },
  { id: 'current_month_received', label: 'Этот месяц', icon: <FaCalendarDay />, params: { period: 'current_month', type: 'received' } },
  { id: 'last_month_received', label: 'Прошлый месяц', icon: <FaCalendarAlt />, params: { period: 'last_month', type: 'received' } },
  { id: 'generosity', label: 'Щедрость', icon: <FaGift />, params: { period: 'current_month', type: 'sent' } },
];

/**
 * Содержимое рейтинга — используется на отдельной странице и внутри главной (моб.).
 *
 * @param {{ user: object, seasonTheme?: string, themeAssets?: object, embedded?: boolean }} props
 */
function LeaderboardContent({ user, seasonTheme, themeAssets, embedded = false }) {
  const [activeTabId, setActiveTabId] = useState(ALL_TABS[0].id);
  const [visibleTabs, setVisibleTabs] = useState(user.is_admin ? ALL_TABS : []);
  const [leaderboard, setLeaderboard] = useState([]);
  const [myRank, setMyRank] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (user.is_admin) return;
    const fetchTabStatuses = async () => {
      try {
        const response = await getLeaderboardStatus();
        const activeTabs = ALL_TABS.filter((tab) => {
          const status = response.data.find((item) => item.id === tab.id);
          return status && status.has_data;
        });

        setVisibleTabs(activeTabs);

        const defaultTabIsVisible = activeTabs.some((tab) => tab.id === ALL_TABS[0].id);
        if (activeTabs.length > 0 && !defaultTabIsVisible) {
          setActiveTabId(activeTabs[0].id);
        } else if (activeTabs.length === 0) {
          setIsLoading(false);
        }
      } catch (error) {
        console.error('Failed to fetch tab statuses', error);
        setIsLoading(false);
      }
    };
    fetchTabStatuses();
  }, [user.is_admin]);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const tabConfig = ALL_TABS.find((tab) => tab.id === activeTabId);
      if (!tabConfig) {
        setIsLoading(false);
        return;
      }

      const [leaderboardRes, myRankRes] = await Promise.all([
        getLeaderboard(tabConfig.params),
        getMyRank(tabConfig.params),
      ]);

      setLeaderboard(leaderboardRes.data);
      setMyRank(myRankRes.data);
    } catch (error) {
      console.error('Failed to fetch leaderboard data', error);
    } finally {
      setIsLoading(false);
    }
  }, [activeTabId]);

  useEffect(() => {
    const currentTab = ALL_TABS.find((tab) => tab.id === activeTabId);
    if (currentTab && visibleTabs.includes(currentTab)) {
      fetchData();
    }
  }, [fetchData, visibleTabs, activeTabId]);

  const top3 = leaderboard.slice(0, 3);
  const others = leaderboard.slice(3);

  const seasonKey = seasonTheme === 'winter' ? 'winter' : 'summer';
  const thanksLogoUrl = resolveSeasonAssets(seasonKey, themeAssets).leaderboard_thanks_logo;

  return (
    <div className={embedded ? styles.embeddedRoot : styles.page}>
      {visibleTabs.length > 0 && (
        <div className={styles.tabsContainer}>
          {visibleTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTabId(tab.id)}
              className={`${styles.tab} ${activeTabId === tab.id ? styles.tabActive : styles.tabCollapsed}`}
            >
              <span className={styles.tabIcon}>{tab.icon}</span>
              <span className={styles.tabLabel}>{tab.label}</span>
            </button>
          ))}
        </div>
      )}

      {isLoading ? (
        <p>Загрузка рейтинга...</p>
      ) : (
        <>
          {myRank && myRank.rank !== null && (
            <div className={styles.myRankCard}>
              <p>
                Вы на <strong>{myRank.rank}-м</strong> месте
              </p>
            </div>
          )}

          {top3.length > 0 && (
            <div className={styles.podium}>
              {top3[1] && (
                <div className={`${styles.podiumItem} ${styles.place2}`}>
                  <FaCrown className={styles.podiumIcon} color="#C0C0C0" />
                  <img
                    src={resolveAvatarUrl(top3[1].user.telegram_photo_url) || 'placeholder.png'}
                    alt={top3[1].user.first_name}
                    className={styles.podiumAvatar}
                    loading="lazy"
                  />
                  <div className={styles.podiumName}>{top3[1].user.first_name}</div>
                  <div className={styles.podiumPoints}>{top3[1].total_received}</div>
                </div>
              )}
              {top3[0] && (
                <div className={`${styles.podiumItem} ${styles.place1}`}>
                  <FaCrown className={styles.podiumIcon} color="#FFD700" />
                  <img
                    src={resolveAvatarUrl(top3[0].user.telegram_photo_url) || 'placeholder.png'}
                    alt={top3[0].user.first_name}
                    className={styles.podiumAvatar}
                    loading="lazy"
                  />
                  <div className={styles.podiumName}>{top3[0].user.first_name}</div>
                  <div className={styles.podiumPoints}>{top3[0].total_received}</div>
                </div>
              )}
              {top3[2] && (
                <div className={`${styles.podiumItem} ${styles.place3}`}>
                  <FaCrown className={styles.podiumIcon} color="#CD7F32" />
                  <img
                    src={resolveAvatarUrl(top3[2].user.telegram_photo_url) || 'placeholder.png'}
                    alt={top3[2].user.first_name}
                    className={styles.podiumAvatar}
                    loading="lazy"
                  />
                  <div className={styles.podiumName}>{top3[2].user.first_name}</div>
                  <div className={styles.podiumPoints}>{top3[2].total_received}</div>
                </div>
              )}
            </div>
          )}

          {others.length > 0 && (
            <ol start="4" className={styles.list}>
              {others.map((item, index) => (
                <li key={item.user.id} className={styles.listItem}>
                  <span className={styles.rank}>{index + 4}</span>
                  <img
                    src={resolveAvatarUrl(item.user.telegram_photo_url) || 'placeholder.png'}
                    alt={item.user.first_name}
                    className={styles.listItemAvatar}
                    loading="lazy"
                  />
                  <div className={styles.userInfo}>
                    <span className={styles.userName}>{item.user.first_name}</span>
                  </div>
                  <div className={styles.pointsContainer}>
                    <span className={styles.points}>{item.total_received}</span>
                    <img src={thanksLogoUrl} alt="спасибо" className={styles.pointsLogo} loading="lazy" />
                  </div>
                </li>
              ))}
            </ol>
          )}

          {leaderboard.length === 0 && visibleTabs.length > 0 && <p>В этом рейтинге пока нет данных.</p>}
          {visibleTabs.length === 0 && !user.is_admin && (
            <p>Рейтинги пока пусты. Скоро здесь появится активность!</p>
          )}
        </>
      )}
    </div>
  );
}

export default LeaderboardContent;
