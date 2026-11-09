-- Drops every NotifyHub object so the database can be rebuilt cleanly.
-- (Works on hosted Postgres like Neon, where you can't drop the schema.)
DROP VIEW IF EXISTS user_inbox, category_stats, dept_engagement, sender_stats CASCADE;

DROP TABLE IF EXISTS audit_log, user_preferences, notification_recipients, notifications,
                     subscriptions, categories, users, departments CASCADE;

DROP FUNCTION  IF EXISTS check_sender_role(), fan_out_notification(), sync_read_at(),
                         audit_changes(), unread_count(INT) CASCADE;
DROP FUNCTION  IF EXISTS send_notification(INT, INT, VARCHAR, TEXT, VARCHAR, TIMESTAMPTZ);
DROP PROCEDURE IF EXISTS mark_all_read(INT), archive_expired();
