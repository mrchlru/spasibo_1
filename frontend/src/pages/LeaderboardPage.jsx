import React from 'react';
import PageLayout from '../components/PageLayout';
import LeaderboardContent from '../components/LeaderboardContent';

function LeaderboardPage({ user, seasonTheme, themeAssets }) {
  return (
    <PageLayout title="Рейтинг">
      <LeaderboardContent user={user} seasonTheme={seasonTheme} themeAssets={themeAssets} />
    </PageLayout>
  );
}

export default LeaderboardPage;
