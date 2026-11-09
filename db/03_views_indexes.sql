-- =====================================================================
-- NotifyHub — 03_views_indexes.sql
-- =====================================================================

-- ---------------------------------------------------------------------
-- INDEXES
-- ---------------------------------------------------------------------
-- Inbox lookups: "all notifications for user X with status Y"
CREATE INDEX idx_nr_user_status ON notification_recipients (user_id, status);

-- Partial index: only unread rows (small, perfect for unread counts)
CREATE INDEX idx_nr_unread ON notification_recipients (user_id) WHERE status = 'unread';

-- Fan-out trigger looks up subscribers by category
-- (the PK (user_id, category_id) can't serve a category-only lookup)
CREATE INDEX idx_subs_category ON subscriptions (category_id);

-- Latest notifications per category
CREATE INDEX idx_notif_category_created ON notifications (category_id, created_at DESC);

-- ---------------------------------------------------------------------
-- VIEW: user_inbox — everything a user sees in their inbox
-- ---------------------------------------------------------------------
CREATE VIEW user_inbox AS
SELECT nr.user_id,
       n.notification_id,
       n.title,
       n.body,
       n.priority,
       c.name        AS category,
       s.name        AS sender,
       nr.status,
       nr.delivered_at,
       nr.read_at,
       n.expires_at
FROM notification_recipients nr
JOIN notifications n ON n.notification_id = nr.notification_id
JOIN categories    c ON c.category_id     = n.category_id
JOIN users         s ON s.user_id         = n.sender_id
WHERE nr.status <> 'archived'
  AND (n.expires_at IS NULL OR n.expires_at > now());

-- ---------------------------------------------------------------------
-- VIEW: category_stats — engagement per category
-- ---------------------------------------------------------------------
CREATE VIEW category_stats AS
SELECT c.category_id,
       c.name AS category,
       (SELECT COUNT(*) FROM subscriptions s WHERE s.category_id = c.category_id) AS subscribers,
       COUNT(DISTINCT n.notification_id)                                          AS notifications_sent,
       COUNT(nr.user_id)                                                          AS deliveries,
       COUNT(nr.read_at)                                                          AS reads,
       ROUND(100.0 * COUNT(nr.read_at) / NULLIF(COUNT(nr.user_id), 0), 1)         AS read_rate_pct,
       ROUND(AVG(EXTRACT(EPOCH FROM (nr.read_at - nr.delivered_at)) / 3600)::NUMERIC, 1)
                                                                                  AS avg_hours_to_read
FROM categories c
LEFT JOIN notifications n            ON n.category_id      = c.category_id
LEFT JOIN notification_recipients nr ON nr.notification_id = n.notification_id
GROUP BY c.category_id, c.name;

-- ---------------------------------------------------------------------
-- VIEW: dept_engagement — how well each department reads its notices
-- ---------------------------------------------------------------------
CREATE VIEW dept_engagement AS
SELECT d.name AS department,
       COUNT(DISTINCT u.user_id)                                          AS users,
       COUNT(nr.notification_id)                                          AS deliveries,
       COUNT(nr.read_at)                                                  AS reads,
       ROUND(100.0 * COUNT(nr.read_at) / NULLIF(COUNT(nr.notification_id), 0), 1) AS read_rate_pct
FROM departments d
JOIN users u                         ON u.dept_id = d.dept_id
LEFT JOIN notification_recipients nr ON nr.user_id = u.user_id
GROUP BY d.dept_id, d.name;

-- ---------------------------------------------------------------------
-- VIEW: sender_stats — who posts the most, and do people read it?
-- ---------------------------------------------------------------------
CREATE VIEW sender_stats AS
SELECT u.user_id,
       u.name AS sender,
       u.role,
       COUNT(DISTINCT n.notification_id)                                   AS posted,
       COUNT(nr.user_id)                                                   AS reached,
       ROUND(100.0 * COUNT(nr.read_at) / NULLIF(COUNT(nr.user_id), 0), 1)  AS read_rate_pct
FROM users u
JOIN notifications n                 ON n.sender_id = u.user_id
LEFT JOIN notification_recipients nr ON nr.notification_id = n.notification_id
GROUP BY u.user_id, u.name, u.role;
