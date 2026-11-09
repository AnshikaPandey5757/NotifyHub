-- =====================================================================
-- NotifyHub — 05_demo_queries.sql
-- Queries to run live during the evaluation. Run them one by one.
-- =====================================================================

-- Q1. A user's inbox (VIEW)
SELECT title, category, sender, priority, status, delivered_at
FROM user_inbox WHERE user_id = 7 ORDER BY delivered_at DESC;

-- Q2. Unread count (FUNCTION)
SELECT unread_count(7);

-- Q3. Send a notification and watch the trigger fan it out (FUNCTION + TRIGGER)
SELECT * FROM send_notification(2, 1, 'Lab tomorrow', 'Bring your laptops.', 'normal');

-- Q4. Students cannot send (TRIGGER raises an error)
-- SELECT * FROM send_notification(7, 1, 'hack', 'should fail');

-- Q5. Mark all read (STORED PROCEDURE)
CALL mark_all_read(7);
SELECT unread_count(7);

-- Q6. Category engagement leaderboard (VIEW + WINDOW FUNCTION)
SELECT category, subscribers, notifications_sent, read_rate_pct,
       RANK() OVER (ORDER BY read_rate_pct DESC NULLS LAST) AS rank
FROM category_stats;

-- Q7. Daily notification volume with running total (WINDOW SUM)
SELECT created_at::DATE AS day,
       COUNT(*) AS sent,
       SUM(COUNT(*)) OVER (ORDER BY created_at::DATE) AS running_total
FROM notifications
GROUP BY created_at::DATE
ORDER BY day;

-- Q8. Average time-to-read by priority (AGGREGATE on intervals)
SELECT n.priority,
       COUNT(nr.read_at) AS reads,
       ROUND(AVG(EXTRACT(EPOCH FROM nr.read_at - nr.delivered_at) / 3600)::NUMERIC, 2) AS avg_hours
FROM notifications n
JOIN notification_recipients nr USING (notification_id)
WHERE nr.read_at IS NOT NULL
GROUP BY n.priority
ORDER BY avg_hours;

-- Q9. Students who have NEVER read anything (ANTI-JOIN with NOT EXISTS)
SELECT u.user_id, u.name
FROM users u
WHERE u.role = 'student'
  AND EXISTS     (SELECT 1 FROM notification_recipients nr WHERE nr.user_id = u.user_id)
  AND NOT EXISTS (SELECT 1 FROM notification_recipients nr
                  WHERE nr.user_id = u.user_id AND nr.status = 'read');

-- Q10. Notifications read by at least 90% of recipients (GROUP BY + HAVING)
SELECT n.title,
       COUNT(*) AS recipients,
       ROUND(100.0 * COUNT(nr.read_at) / COUNT(*), 1) AS read_pct
FROM notifications n
JOIN notification_recipients nr USING (notification_id)
GROUP BY n.notification_id, n.title
HAVING COUNT(nr.read_at)::NUMERIC / COUNT(*) >= 0.9
ORDER BY read_pct DESC;

-- Q11. Latest notification per category (ROW_NUMBER partition)
SELECT category, title, created_at
FROM (
    SELECT c.name AS category, n.title, n.created_at,
           ROW_NUMBER() OVER (PARTITION BY n.category_id ORDER BY n.created_at DESC) AS rn
    FROM notifications n JOIN categories c USING (category_id)
) t
WHERE rn = 1;

-- Q12. RELATIONAL DIVISION: students subscribed to EVERY optional category
-- (Placements, Hostel, Coding Club, Sports)
SELECT u.user_id, u.name
FROM users u
WHERE u.role = 'student'
  AND NOT EXISTS (
        SELECT c.category_id FROM categories c WHERE c.category_id IN (4, 5, 7, 8)
        EXCEPT
        SELECT s.category_id FROM subscriptions s WHERE s.user_id = u.user_id
  );

-- Q13. Department engagement (VIEW)
SELECT * FROM dept_engagement ORDER BY read_rate_pct DESC;

-- Q14. Index in action (EXPLAIN ANALYZE) — look for "Index Scan" / "Bitmap Index Scan"
EXPLAIN ANALYZE
SELECT * FROM notification_recipients WHERE user_id = 7 AND status = 'unread';

-- Q15. TRANSACTION demo: everything or nothing
BEGIN;
    SELECT * FROM send_notification(5, 4, 'Draft drive', 'This will be rolled back', 'normal');
    SAVEPOINT before_mistake;
    DELETE FROM subscriptions WHERE category_id = 4;    -- oops
    ROLLBACK TO SAVEPOINT before_mistake;               -- undo just the mistake
    SELECT COUNT(*) AS placement_subscribers FROM subscriptions WHERE category_id = 4;
ROLLBACK;                                               -- undo the whole thing

-- Q16. Audit trail written by triggers
SELECT table_name, action, record_id, logged_at
FROM audit_log ORDER BY log_id DESC LIMIT 20;
