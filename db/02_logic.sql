-- =====================================================================
-- NotifyHub — 02_logic.sql
-- Triggers, functions and stored procedures.
-- =====================================================================

-- ---------------------------------------------------------------------
-- TRIGGER 1: Only faculty/admin may send notifications (business rule
-- enforced inside the database, so no app can bypass it).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_sender_role() RETURNS TRIGGER AS $$
DECLARE
    v_role VARCHAR(20);
BEGIN
    SELECT role INTO v_role FROM users WHERE user_id = NEW.sender_id;
    IF v_role IS NULL THEN
        RAISE EXCEPTION 'Sender % does not exist', NEW.sender_id;
    ELSIF v_role = 'student' THEN
        RAISE EXCEPTION 'Students cannot send notifications (user %)', NEW.sender_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_sender_role
BEFORE INSERT ON notifications
FOR EACH ROW EXECUTE FUNCTION check_sender_role();

-- ---------------------------------------------------------------------
-- TRIGGER 2 (the showpiece): FAN-OUT.
-- When a notification is inserted, create one notification_recipients
-- row for every subscriber of that category — except the sender and
-- users who muted in-app notifications. URGENT notifications ignore
-- the mute setting.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fan_out_notification() RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO notification_recipients (notification_id, user_id, delivered_at)
    SELECT NEW.notification_id, s.user_id, NEW.created_at
    FROM subscriptions s
    WHERE s.category_id = NEW.category_id
      AND s.user_id <> NEW.sender_id
      AND (
            NEW.priority = 'urgent'
            OR NOT EXISTS (
                SELECT 1 FROM user_preferences p
                WHERE p.user_id = s.user_id
                  AND p.channel = 'in_app'
                  AND p.enabled = FALSE
            )
          );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_fan_out_notification
AFTER INSERT ON notifications
FOR EACH ROW EXECUTE FUNCTION fan_out_notification();

-- ---------------------------------------------------------------------
-- TRIGGER 3: Keep read_at consistent with status automatically.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_read_at() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'read' AND OLD.status <> 'read' THEN
        NEW.read_at := COALESCE(NEW.read_at, now());
    ELSIF NEW.status = 'unread' THEN
        NEW.read_at := NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_read_at
BEFORE UPDATE OF status ON notification_recipients
FOR EACH ROW EXECUTE FUNCTION sync_read_at();

-- ---------------------------------------------------------------------
-- TRIGGER 4: Generic audit trail. One function reused on several tables;
-- TG_ARGV[0] tells it which column is the record id.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_changes() RETURNS TRIGGER AS $$
DECLARE
    v_row JSONB;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_row := to_jsonb(OLD);
    ELSE
        v_row := to_jsonb(NEW);
    END IF;

    INSERT INTO audit_log (table_name, action, record_id, details)
    VALUES (TG_TABLE_NAME, TG_OP, (v_row ->> TG_ARGV[0])::INT, v_row::TEXT);

    RETURN NULL;  -- AFTER trigger: return value ignored
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_notifications
AFTER INSERT OR DELETE ON notifications
FOR EACH ROW EXECUTE FUNCTION audit_changes('notification_id');

CREATE TRIGGER trg_audit_users
AFTER INSERT OR UPDATE OR DELETE ON users
FOR EACH ROW EXECUTE FUNCTION audit_changes('user_id');

CREATE TRIGGER trg_audit_subscriptions
AFTER INSERT OR DELETE ON subscriptions
FOR EACH ROW EXECUTE FUNCTION audit_changes('user_id');

-- ---------------------------------------------------------------------
-- FUNCTION: send_notification — one call to post a notice.
-- Returns the new id and how many users it reached (via the trigger).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION send_notification(
    p_sender     INT,
    p_category   INT,
    p_title      VARCHAR,
    p_body       TEXT,
    p_priority   VARCHAR DEFAULT 'normal',
    p_expires_at TIMESTAMPTZ DEFAULT NULL
) RETURNS TABLE (notification_id INT, recipients INT) AS $$
DECLARE
    v_id INT;
BEGIN
    INSERT INTO notifications (sender_id, category_id, title, body, priority, expires_at)
    VALUES (p_sender, p_category, p_title, p_body, p_priority, p_expires_at)
    RETURNING notifications.notification_id INTO v_id;

    RETURN QUERY
    SELECT v_id, COUNT(*)::INT
    FROM notification_recipients nr
    WHERE nr.notification_id = v_id;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- FUNCTION: unread_count(user)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION unread_count(p_user INT) RETURNS INT AS $$
    SELECT COUNT(*)::INT
    FROM notification_recipients nr
    JOIN notifications n USING (notification_id)
    WHERE nr.user_id = p_user
      AND nr.status = 'unread'
      AND (n.expires_at IS NULL OR n.expires_at > now());
$$ LANGUAGE sql STABLE;

-- ---------------------------------------------------------------------
-- PROCEDURE: mark_all_read(user)   -> CALL mark_all_read(7);
-- ---------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE mark_all_read(p_user INT) AS $$
BEGIN
    UPDATE notification_recipients
    SET status = 'read'
    WHERE user_id = p_user AND status = 'unread';
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- PROCEDURE: archive_expired()  -> CALL archive_expired();
-- Moves every delivery of an expired notification to 'archived'.
-- ---------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE archive_expired() AS $$
BEGIN
    UPDATE notification_recipients nr
    SET status = 'archived'
    FROM notifications n
    WHERE n.notification_id = nr.notification_id
      AND n.expires_at IS NOT NULL
      AND n.expires_at <= now()
      AND nr.status <> 'archived';
END;
$$ LANGUAGE plpgsql;
