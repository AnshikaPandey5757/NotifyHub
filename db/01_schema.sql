-- =====================================================================
-- NotifyHub — 01_schema.sql
-- Tables + constraints. Normalized to 3NF (see README for the FDs).
-- =====================================================================

CREATE TABLE departments (
    dept_id   SERIAL PRIMARY KEY,
    name      VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE users (
    user_id    SERIAL PRIMARY KEY,
    name       VARCHAR(100) NOT NULL,
    email      VARCHAR(150) NOT NULL UNIQUE,
    role       VARCHAR(20)  NOT NULL CHECK (role IN ('student','faculty','admin')),
    dept_id    INT REFERENCES departments(dept_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A category is a "channel" users can subscribe to (e.g. Placements, Hostel)
CREATE TABLE categories (
    category_id   SERIAL PRIMARY KEY,
    name          VARCHAR(100) NOT NULL UNIQUE,
    description   TEXT,
    owner_dept_id INT REFERENCES departments(dept_id) ON DELETE SET NULL
);

-- Many-to-many: users <-> categories
CREATE TABLE subscriptions (
    user_id       INT REFERENCES users(user_id) ON DELETE CASCADE,
    category_id   INT REFERENCES categories(category_id) ON DELETE CASCADE,
    subscribed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, category_id)
);

CREATE TABLE notifications (
    notification_id SERIAL PRIMARY KEY,
    sender_id       INT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    category_id     INT NOT NULL REFERENCES categories(category_id) ON DELETE CASCADE,
    title           VARCHAR(200) NOT NULL,
    body            TEXT NOT NULL,
    priority        VARCHAR(10) NOT NULL DEFAULT 'normal'
                    CHECK (priority IN ('low','normal','high','urgent')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ,
    CHECK (expires_at IS NULL OR expires_at > created_at)
);

-- Core table: one row per (notification, recipient) — tracks delivery & read status
CREATE TABLE notification_recipients (
    notification_id INT REFERENCES notifications(notification_id) ON DELETE CASCADE,
    user_id         INT REFERENCES users(user_id) ON DELETE CASCADE,
    status          VARCHAR(10) NOT NULL DEFAULT 'unread'
                    CHECK (status IN ('unread','read','archived')),
    delivered_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    read_at         TIMESTAMPTZ,
    PRIMARY KEY (notification_id, user_id),
    CHECK (read_at IS NULL OR read_at >= delivered_at)
);

-- Which channels each user wants notifications on
CREATE TABLE user_preferences (
    user_id INT REFERENCES users(user_id) ON DELETE CASCADE,
    channel VARCHAR(10) CHECK (channel IN ('in_app','email','sms')),
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (user_id, channel)
);

-- Filled automatically by triggers (see 02_logic.sql)
CREATE TABLE audit_log (
    log_id     BIGSERIAL PRIMARY KEY,
    table_name VARCHAR(50) NOT NULL,
    action     VARCHAR(10) NOT NULL,
    record_id  INT,
    details    TEXT,
    logged_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
