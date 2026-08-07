CREATE TABLE IF NOT EXISTS task_notification_log (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind VARCHAR(32) NOT NULL,
    task_id INTEGER NOT NULL DEFAULT 0,
    sent_on DATE NOT NULL,
    UNIQUE (user_id, kind, task_id, sent_on)
);

CREATE INDEX IF NOT EXISTS idx_task_notification_log_user_sent ON task_notification_log(user_id, sent_on);
