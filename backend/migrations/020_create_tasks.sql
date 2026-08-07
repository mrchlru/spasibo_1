CREATE TABLE IF NOT EXISTS task_quota_settings (
    id SERIAL PRIMARY KEY,
    max_daily_tasks INTEGER NOT NULL DEFAULT 3,
    max_weekly_tasks INTEGER NOT NULL DEFAULT 2,
    max_monthly_tasks INTEGER NOT NULL DEFAULT 1,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO task_quota_settings (max_daily_tasks, max_weekly_tasks, max_monthly_tasks)
SELECT 3, 2, 1
WHERE NOT EXISTS (SELECT 1 FROM task_quota_settings LIMIT 1);

CREATE TABLE IF NOT EXISTS tasks (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    period_type VARCHAR(16) NOT NULL,
    is_system BOOLEAN NOT NULL DEFAULT false,
    system_key VARCHAR(64),
    target_count INTEGER NOT NULL DEFAULT 1,
    reward_likes INTEGER NOT NULL DEFAULT 1,
    is_active BOOLEAN NOT NULL DEFAULT true,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_tasks_period_type CHECK (period_type IN ('daily', 'weekly', 'monthly'))
);

CREATE INDEX IF NOT EXISTS idx_tasks_period_active ON tasks(period_type, is_active, sort_order);

CREATE TABLE IF NOT EXISTS user_task_progress (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    period_start DATE NOT NULL,
    current_count INTEGER NOT NULL DEFAULT 0,
    completed_at TIMESTAMP,
    reward_granted BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (user_id, task_id, period_start)
);

CREATE INDEX IF NOT EXISTS idx_user_task_progress_user ON user_task_progress(user_id);

INSERT INTO tasks (
    title,
    description,
    period_type,
    is_system,
    system_key,
    target_count,
    reward_likes,
    is_active,
    sort_order
)
SELECT
    'Поблагодарить коллегу',
    'Отправьте спасибки коллегам — прогресс обновляется автоматически.',
    'daily',
    true,
    'send_likes',
    3,
    1,
    true,
    0
WHERE NOT EXISTS (
    SELECT 1 FROM tasks WHERE system_key = 'send_likes'
);
