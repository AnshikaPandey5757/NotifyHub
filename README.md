# NotifyHub: Campus Notification System

NotifyHub is a DBMS project built on **PostgreSQL**. Departments, faculty and the admin office post
notices to **categories** (CSE Department, Placements, Hostel, Exams…). Students subscribe to the
categories they care about and get an **inbox** with read/unread tracking, priorities and expiry.

The point of the project is *where* the logic lives. Fan-out to subscribers, the "students can't
send" rule, read-time tracking and the audit trail are all **inside the database**, written as
triggers, functions, stored procedures and views. The Node/Express server is a thin layer that calls
them, and the web UI is a single static HTML page.

---

## Contents

1. [Features](#features)
2. [Tech stack](#tech-stack)
3. [Architecture](#architecture)
4. [Project structure](#project-structure)
5. [Run it locally](#run-it-locally)
6. [Deploy it (Neon + Render, free)](#deploy-it-neon--render-free)
7. [Configuration reference](#configuration-reference)
8. [How the database gets built](#how-the-database-gets-built)
9. [Database design](#database-design)
10. [Business logic in the database](#business-logic-in-the-database)
11. [Views and indexes](#views-and-indexes)
12. [Sample data](#sample-data)
13. [The web app](#the-web-app)
14. [REST API reference](#rest-api-reference)
15. [SQL Playground and its safety rules](#sql-playground-and-its-safety-rules)
16. [Security model and known limitations](#security-model-and-known-limitations)
17. [DBMS concepts: where to find them](#dbms-concepts-where-to-find-them)
18. [Demo queries (05_demo_queries.sql)](#demo-queries-05_demo_queriessql)
19. [Demo script for the evaluation](#demo-script-for-the-evaluation)
20. [Likely viva questions](#likely-viva-questions)
21. [Troubleshooting](#troubleshooting)
22. [Future work](#future-work)

---

## Features

- **Category subscriptions.** Users subscribe to and unsubscribe from channels such as *Placements* or *Coding Club*.
- **Fan-out on write.** Posting one notice creates one delivery row per subscriber, done by a trigger.
- **Priorities:** `low`, `normal`, `high`, `urgent`. Urgent notices reach users even if they've muted in-app notifications.
- **Read tracking.** `read_at` is set automatically when a delivery is marked read.
- **Expiry and archiving.** Notices can expire. A procedure archives expired deliveries, and the inbox view hides them.
- **Role rule.** Only faculty and admin can send. Students are rejected by a trigger, whoever is writing to the database.
- **Multi-category send in one transaction.** It's all or nothing: if one category fails, nothing is sent.
- **Analytics.** Read rates and time-to-read by category, department, sender and priority, all computed by views.
- **Audit log.** Inserts, updates and deletes on key tables are recorded by one generic trigger function.
- **SQL Playground.** Run SQL live against the database, read-only by default.
- **UI.** Light (parchment) and dark themes with a toggle, plus a mobile layout with a bottom tab bar.
- **Deployable for free** on Render (app) and Neon (Postgres). The database builds itself on first start.

## Tech stack

| Layer | Technology |
|---|---|
| Database | PostgreSQL 14+ (tested with Neon's hosted Postgres) |
| Server | Node.js 18+, Express 4, `pg` (node-postgres) 8 |
| Frontend | A single static `public/index.html`: plain HTML, CSS and JavaScript, no build step and no framework |
| Fonts | Newsreader (headings), IBM Plex Sans (text), IBM Plex Mono (code), all from Google Fonts |
| Hosting | Render (web service) + Neon (database) |

## Architecture

```mermaid
flowchart LR
    B["Browser<br/>public/index.html"] -- "fetch /api/*" --> S["Express server<br/>server.js"]
    S -- "SQL: SELECT / CALL / function calls" --> D[("PostgreSQL<br/>tables + triggers + functions<br/>+ procedures + views")]
    D -- "rows / errors" --> S
    S -- "JSON" --> B
```

- The **browser** never talks to the database directly. It calls JSON endpoints.
- The **server** has no business rules of its own. For example, `POST /api/notifications` just calls the
  `send_notification()` function inside a transaction, and the triggers do the rest.
- The **database** enforces every rule, so the same rules hold if you connect with `psql`, pgAdmin
  or the SQL Playground.

## Project structure

```
notifyhub/
├── db/
│   ├── 00_reset.sql          Drops every NotifyHub object (works on Neon, where you can't drop the schema)
│   ├── 01_schema.sql         8 tables with PK / FK / UNIQUE / NOT NULL / CHECK constraints
│   ├── 02_logic.sql          4 triggers, 3 functions, 2 stored procedures
│   ├── 03_views_indexes.sql  4 views, 4 indexes (including a partial index)
│   ├── 04_seed.sql           200 users, 8 categories, 30 notices, a few thousand deliveries
│   └── 05_demo_queries.sql   16 queries to run live in the viva (not run automatically)
├── public/
│   └── index.html            The whole UI: Inbox, Compose, Analytics, SQL Playground, Audit Log
├── server.js                 Express API (thin layer over the DB logic) + auto-build on first start
├── db-setup.js               Runs files 00 to 04 in order. Shared by server.js and setup.js
├── setup.js                  `npm run setup`: wipes and rebuilds the DB with fresh sample data
├── config.js                 DB connection: DATABASE_URL (Neon) or local PG* settings
├── package.json              Scripts: `npm start`, `npm run setup`
└── .gitignore                Ignores node_modules/ and .env
```

---

## Run it locally

You need **Node.js 18 or newer**. For the database you have two options.

### Option A: use a Neon database (easiest, nothing to install)

```powershell
npm install
$env:DATABASE_URL="postgresql://<user>:<password>@<host>.neon.tech/neondb?sslmode=require"
npm start
```

Open **http://localhost:3000**. On the first start, the server sees the database is empty and builds
everything: tables, triggers, views and sample data.

### Option B: use PostgreSQL installed on your PC

```powershell
npm install
$env:PGPASSWORD="your-postgres-password"   # don't type it into config.js, so it never reaches GitHub
npm run setup                               # creates the "notifyhub" database if missing, then builds it
npm start
```

With no `DATABASE_URL`, `config.js` falls back to `localhost:5432`, user `postgres`, database
`notifyhub`. Override any of these with the `PG*` variables listed below.

### Reset the sample data at any time

```powershell
npm run setup
```

This **drops every NotifyHub object** and rebuilds from scratch. Anything you sent, read or
subscribed to is lost. Subscriptions and read history are randomised, so the exact numbers differ
after each reset.

To run the demo queries in `psql` instead of the UI:

```powershell
psql -U postgres -d notifyhub -f db/05_demo_queries.sql
```

---

## Deploy it (Neon + Render, free)

### 1. Database on Neon

1. Sign up at https://neon.com (you can use *Continue with GitHub*).
2. Create a project named `notifyhub`. Pick a region close to your users, e.g. **AWS Asia Pacific (Singapore)**.
3. Click **Connect** and copy the connection string. It looks like
   `postgresql://neondb_owner:...@ep-....neon.tech/neondb?sslmode=require`.

### 2. Code on GitHub

Create a repository named `notifyhub` (private is fine) and push this folder:

```powershell
git init
git add .
git commit -m "NotifyHub"
git branch -M main
git remote add origin https://github.com/<your-username>/notifyhub.git
git push -u origin main
```

`.gitignore` keeps `node_modules/` and any `.env` file out of the repository.

### 3. App on Render

1. Sign up at https://render.com with GitHub.
2. Click **New → Web Service** and pick the `notifyhub` repository.
3. Use these settings:

   | Setting | Value |
   |---|---|
   | Language | Node |
   | Build Command | `npm install` |
   | Start Command | `npm start` |
   | Region | Same as Neon (e.g. Singapore) |
   | Instance Type | Free |
   | Health Check Path | `/health` |

4. Under **Environment Variables**, add `DATABASE_URL` set to the Neon connection string.
5. Click **Deploy**. On first start the app builds everything in Neon by itself. You get a URL like
   `https://notifyhub-xxxx.onrender.com`.

### Things to know about the free tiers

- **Render sleeps after 15 minutes without traffic.** The next visit takes about a minute to wake
  up, so open the link a couple of minutes before a demo. An uptime pinger (e.g. UptimeRobot) hitting
  `/health` every 10 minutes keeps it awake. `/health` doesn't touch the database, so it doesn't wake Neon.
- **Neon suspends idle databases and closes their connections.** The server handles this: the pool
  has an `error` handler, so a dropped idle connection is logged instead of crashing the app, and the
  next query opens a new connection.
- **Redeploys don't wipe data.** The auto-build only runs when the `notification_recipients` table
  doesn't exist. To reset a deployed database, run `npm run setup` from your PC with `DATABASE_URL`
  pointing at Neon.

---

## Configuration reference

| Variable | Used when | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | Set | none | Full Postgres connection string. When set, every `PG*` variable is ignored. SSL is on unless the host is `localhost` / `127.0.0.1` |
| `PGHOST` | No `DATABASE_URL` | `localhost` | Local Postgres host |
| `PGPORT` | No `DATABASE_URL` | `5432` | Local Postgres port |
| `PGUSER` | No `DATABASE_URL` | `postgres` | Local Postgres user |
| `PGPASSWORD` | No `DATABASE_URL` | `postgres` | Local Postgres password |
| `PGDATABASE` | No `DATABASE_URL` | `notifyhub` | Database name, created automatically by `npm run setup` if missing |
| `PORT` | Always | `3000` | HTTP port (Render sets it for you) |

Connection pool settings are in `server.js`: idle connections close after 10 s, and a new
connection gives up after 15 s.

## How the database gets built

`db-setup.js` runs these files in order, each as one multi-statement query:

| Order | File | What it does |
|---|---|---|
| 1 | `00_reset.sql` | Drops views, tables, functions and procedures if they exist, so the rebuild is clean |
| 2 | `01_schema.sql` | Creates the 8 tables and their constraints |
| 3 | `02_logic.sql` | Creates the trigger functions, triggers, functions and procedures |
| 4 | `03_views_indexes.sql` | Creates the indexes and views |
| 5 | `04_seed.sql` | Inserts sample data. The fan-out trigger creates the deliveries |

It runs in two situations:

- **`npm run setup`**: always, which means a full wipe and rebuild. On a local install it first
  creates the database if it doesn't exist.
- **`npm start`**: only if `to_regclass('public.notification_recipients')` is `NULL`, i.e. the
  database is empty. If the database can't be reached, the server logs the error and exits, so Render
  shows the deploy as failed instead of serving a broken app.

`05_demo_queries.sql` is **never** run automatically. Run it by hand in `psql` or use the
Playground presets.

---

## Database design

### ER diagram

```mermaid
erDiagram
    DEPARTMENTS ||--o{ USERS : "has"
    DEPARTMENTS ||--o{ CATEGORIES : "owns"
    USERS ||--o{ SUBSCRIPTIONS : "subscribes"
    CATEGORIES ||--o{ SUBSCRIPTIONS : "has subscribers"
    USERS ||--o{ NOTIFICATIONS : "sends"
    CATEGORIES ||--o{ NOTIFICATIONS : "contains"
    NOTIFICATIONS ||--o{ NOTIFICATION_RECIPIENTS : "delivered as"
    USERS ||--o{ NOTIFICATION_RECIPIENTS : "receives"
    USERS ||--o{ USER_PREFERENCES : "sets"

    DEPARTMENTS {
        int dept_id PK
        varchar name UK
    }
    USERS {
        int user_id PK
        varchar name
        varchar email UK
        varchar role
        int dept_id FK
        timestamptz created_at
    }
    CATEGORIES {
        int category_id PK
        varchar name UK
        text description
        int owner_dept_id FK
    }
    SUBSCRIPTIONS {
        int user_id PK,FK
        int category_id PK,FK
        timestamptz subscribed_at
    }
    NOTIFICATIONS {
        int notification_id PK
        int sender_id FK
        int category_id FK
        varchar title
        text body
        varchar priority
        timestamptz created_at
        timestamptz expires_at
    }
    NOTIFICATION_RECIPIENTS {
        int notification_id PK,FK
        int user_id PK,FK
        varchar status
        timestamptz delivered_at
        timestamptz read_at
    }
    USER_PREFERENCES {
        int user_id PK,FK
        varchar channel PK
        boolean enabled
    }
    AUDIT_LOG {
        bigint log_id PK
        varchar table_name
        varchar action
        int record_id
        text details
        timestamptz logged_at
    }
```

GitHub renders this automatically. For a picture in your report, paste it into https://mermaid.live.

**Relationships**
- Users ↔ Categories is **many-to-many**, resolved by `subscriptions`.
- Notifications ↔ Users (as recipients) is **many-to-many**, resolved by `notification_recipients`.
- Departments → Users, Departments → Categories and Users → Notifications (as sender) are **one-to-many**.
- `audit_log` is deliberately **not** linked by foreign keys. It must keep its history even after
  the rows it describes are deleted.

### Tables in detail

| Table | Key | Notable constraints |
|---|---|---|
| `departments` | `dept_id` SERIAL | `name` NOT NULL UNIQUE |
| `users` | `user_id` SERIAL | `email` UNIQUE; `role` CHECK in (`student`, `faculty`, `admin`); `dept_id` → departments **ON DELETE SET NULL** |
| `categories` | `category_id` SERIAL | `name` UNIQUE; `owner_dept_id` → departments **ON DELETE SET NULL** (NULL = campus-wide, e.g. Exams) |
| `subscriptions` | (`user_id`, `category_id`) | Both FKs **ON DELETE CASCADE** |
| `notifications` | `notification_id` SERIAL | `sender_id` → users **ON DELETE RESTRICT** (can't delete someone who has posted); `category_id` **CASCADE**; `priority` CHECK in (`low`, `normal`, `high`, `urgent`); `CHECK (expires_at IS NULL OR expires_at > created_at)`; `title` VARCHAR(200) |
| `notification_recipients` | (`notification_id`, `user_id`) | Both FKs **CASCADE**; `status` CHECK in (`unread`, `read`, `archived`); `CHECK (read_at IS NULL OR read_at >= delivered_at)` |
| `user_preferences` | (`user_id`, `channel`) | `channel` CHECK in (`in_app`, `email`, `sms`); `enabled` defaults to TRUE |
| `audit_log` | `log_id` BIGSERIAL | Written only by triggers |

### Normalization (3NF / BCNF)

In every table, the left side of every functional dependency is a key, so every table is in **BCNF**.

| Table | Functional dependencies |
|---|---|
| departments | dept_id → name; name → dept_id |
| users | user_id → name, email, role, dept_id, created_at; email → user_id |
| categories | category_id → name, description, owner_dept_id; name → category_id |
| subscriptions | (user_id, category_id) → subscribed_at |
| notifications | notification_id → sender_id, category_id, title, body, priority, created_at, expires_at |
| notification_recipients | (notification_id, user_id) → status, delivered_at, read_at |
| user_preferences | (user_id, channel) → enabled |
| audit_log | log_id → everything |

Design decisions worth explaining:
- **The department name isn't stored in `users`.** That would create a transitive dependency,
  user_id → dept_id → dept_name, which violates 3NF.
- **Recipients aren't a list column in `notifications`.** A list is multi-valued and breaks 1NF.
  Each recipient also has their own status and read time, so they need their own table with a
  composite key.
- **Deliveries are stored, not computed from subscriptions at read time (fan-out on write).**
  Someone who subscribes today shouldn't suddenly get last month's notices, and read status needs a
  row to live in anyway.

---

## Business logic in the database

All of this is in `db/02_logic.sql`.

### Triggers

| Trigger | Fires | Function | What it does |
|---|---|---|---|
| `trg_check_sender_role` | BEFORE INSERT on `notifications` | `check_sender_role()` | Looks up the sender's role. Raises an error if the sender doesn't exist or is a `student` |
| `trg_fan_out_notification` | AFTER INSERT on `notifications` | `fan_out_notification()` | Inserts one `notification_recipients` row per subscriber of the category, **except** the sender and users who disabled `in_app`. **Urgent** notices ignore the mute |
| `trg_sync_read_at` | BEFORE UPDATE OF `status` on `notification_recipients` | `sync_read_at()` | `unread → read` sets `read_at = now()` (if not given); back to `unread` clears `read_at` |
| `trg_audit_notifications` | AFTER INSERT/DELETE on `notifications` | `audit_changes('notification_id')` | Writes the row as JSON to `audit_log` |
| `trg_audit_users` | AFTER INSERT/UPDATE/DELETE on `users` | `audit_changes('user_id')` | Same as above |
| `trg_audit_subscriptions` | AFTER INSERT/DELETE on `subscriptions` | `audit_changes('user_id')` | Same as above |

`audit_changes()` is one generic function reused on three tables. `TG_ARGV[0]` tells it which column
holds the record id, `TG_TABLE_NAME` and `TG_OP` fill in the table and action, and `to_jsonb(NEW/OLD)`
captures the whole row.

### Functions

| Function | Returns | Purpose |
|---|---|---|
| `send_notification(sender, category, title, body, priority = 'normal', expires_at = NULL)` | `TABLE(notification_id INT, recipients INT)` | Inserts a notice, so the triggers validate it and fan it out, then reports how many people it reached |
| `unread_count(user_id)` | `INT` | Unread, non-expired deliveries for a user. Declared `STABLE` so it can be used in queries |

### Stored procedures

| Procedure | Purpose |
|---|---|
| `CALL mark_all_read(user_id)` | Marks all of a user's unread deliveries as read. `read_at` gets filled by the trigger |
| `CALL archive_expired()` | Sets every delivery of an expired notice to `archived` |

### Transactions

- **Inside one send:** the notice insert and all its fan-out rows are one statement's work, so they
  are saved together or not at all.
- **Across several categories:** `POST /api/notifications` runs `BEGIN`, calls `send_notification()`
  once per category, then `COMMIT`s. If any call fails (e.g. the sender is a student), it does a
  `ROLLBACK` and **nothing** is sent.
- **SQL Playground:** each query runs in its own transaction, `BEGIN READ ONLY … ROLLBACK` by default.

## Views and indexes

All of this is in `db/03_views_indexes.sql`.

### Views

| View | Columns | Used by |
|---|---|---|
| `user_inbox` | user_id, notification_id, title, body, priority, category, sender, status, delivered_at, read_at, expires_at. **Hides archived and expired notices** | Inbox page |
| `category_stats` | category, subscribers, notifications_sent, deliveries, reads, read_rate_pct, avg_hours_to_read | Analytics → Categories |
| `dept_engagement` | department, users, deliveries, reads, read_rate_pct | Analytics → Departments |
| `sender_stats` | user_id, sender, role, posted, reached, read_rate_pct | Analytics → Senders |

### Indexes

| Index | Definition | Why |
|---|---|---|
| `idx_nr_user_status` | `notification_recipients (user_id, status)` | Inbox lookups: "user X's rows with status Y" |
| `idx_nr_unread` | `notification_recipients (user_id) WHERE status = 'unread'` | **Partial index.** Only unread rows, so it's small and makes unread counts fast |
| `idx_subs_category` | `subscriptions (category_id)` | The fan-out trigger finds subscribers by category, and the PK `(user_id, category_id)` can't serve a lookup by category alone |
| `idx_notif_category_created` | `notifications (category_id, created_at DESC)` | Latest notices per category |

---

## Sample data

`db/04_seed.sql` creates:

- **5 departments:** Computer Science, Electronics, Mechanical, Training & Placement, Hostel Office.
- **200 users:** 1 admin, 5 faculty and 14 named students (ids 1–20), plus 180 generated students
  (`Student 021` … `Student 200`) spread across the three academic departments.
- **8 categories:** CSE / ECE / ME Department, Placements, Hostel, Exams, Coding Club, Sports.
- **Subscriptions:** every student follows their own department and *Exams*. Optional categories are
  random: Placements about 75%, Hostel 55%, Coding Club 35%, Sports 30%. Faculty follow Placements and
  Exams. User 7 is always subscribed to Placements and Coding Club, so the demo inbox is never empty.
- **Preferences:** about 6% of the generated students have muted in-app notifications, and about 60%
  of users have email turned on.
- **30 notices** spread over the last month. One has already expired and gets archived.
- **Reading behaviour:** urgent notices are read by about 95% of recipients within 6 h, high 80%
  within 24 h, normal 60% within 48 h, low 35% within 96 h.
- **"Ghost" students** 193–200 never read anything, for the anti-join demo (Q9).
- The **audit log starts empty** (`TRUNCATE … RESTART IDENTITY`), so the demo shows only your actions.

### Named users (ids 1–20)

| ID | Name | Role | Department |
|---|---|---|---|
| 1 | Admin Office | admin | — |
| 2 | Dr. Meera Iyer | faculty | Computer Science |
| 3 | Dr. Rajesh Kumar | faculty | Electronics |
| 4 | Prof. Anil Verma | faculty | Mechanical |
| 5 | Neha Kapoor (TPO) | faculty | Training & Placement |
| 6 | Suresh Patil | faculty | Hostel Office |
| 7 | **Siddharth Paul** | student | Computer Science |
| 8 | **Anshika Pandey** | student | Computer Science |
| 9 | **Bhavesh** | student | Computer Science |
| 10 | **Dhwanit Vyas** | student | Computer Science |
| 11 | **Kunal** | student | Electronics |
| 12 | Rohan Desai | student | Electronics |
| 13 | Priya Nair | student | Electronics |
| 14 | Vikram Joshi | student | Mechanical |
| 15 | Sneha Kulkarni | student | Mechanical |
| 16 | Arjun Reddy | student | Mechanical |
| 17 | Diya Malhotra | student | Computer Science |
| 18 | Ananya Gupta | student | Electronics |
| 19 | Pooja Yadav | student | Mechanical |
| 20 | Harsh Agarwal | student | Computer Science |

The UI's user pickers list only these 20. The 180 generated students exist for realistic analytics.

> If the app still shows the old names, your database was built from an older seed. Run
> `npm run setup` (with `DATABASE_URL` set if it's Neon) to rebuild it.

---

## The web app

`public/index.html` is a single file with no build step. Pick who you are in **Viewing as**, at the
bottom of the sidebar on desktop or at the top on mobile.

| Page | What you can do |
|---|---|
| **Inbox** | See notices grouped by Today / Yesterday / This week / Earlier, with a coloured stripe for priority. Click an unread notice to mark it read. Filter All / Unread. **Mark all read** calls the stored procedure. The right column toggles subscriptions and the in-app preference |
| **Compose** | Pick a sender, one or more categories (tags), title, message, priority and optional expiry. The side panels show the maximum reach and a live preview of the inbox card. Choosing a student as sender shows the trigger rejecting it |
| **Analytics** | Headline numbers (users, notices, deliveries, read rate) and tables from the four views, with read-rate bars |
| **SQL Playground** | 14 preset queries (views, functions, window functions, relational division, EXPLAIN ANALYZE, trigger and procedure demos) or your own SQL. Ctrl+Enter runs it |
| **Audit Log** | The latest 100 rows written by the audit triggers, with colour-coded INSERT / UPDATE / DELETE |

**Themes:** the moon/sun button next to the logo switches between the light parchment theme and the
dark theme. The first visit follows the device's setting, and your choice is remembered in the browser.

**Mobile:** under 760 px wide, the sidebar becomes a compact header and the five sections move to a
bottom tab bar. Wide tables scroll sideways inside their panel, and form fields use a 16 px font so
iOS doesn't zoom in.

---

## REST API reference

All endpoints take and return JSON. Errors come back as **HTTP 400** with `{ "error": "message" }`,
usually the database's own error text (e.g. from a trigger).

| Method | Path | Body | Returns | Calls |
|---|---|---|---|---|
| GET | `/health` | — | `ok` (plain text) | Nothing. Doesn't touch the DB |
| GET | `/api/users` | — | `[{ user_id, name, role, department }]`, admin first, then faculty, then students | `users` ⟕ `departments` |
| GET | `/api/categories` | — | `[{ category_id, name, description, subscribers }]` | `categories` + count |
| GET | `/api/users/:id/inbox` | — | `{ unread, items: [user_inbox rows] }` | view `user_inbox`, function `unread_count()` |
| POST | `/api/users/:id/read/:nid` | — | `{ ok: true }` | `UPDATE … SET status='read'` → trigger sets `read_at` |
| POST | `/api/users/:id/read-all` | — | `{ ok: true }` | `CALL mark_all_read(id)` |
| GET | `/api/users/:id/settings` | — | `{ subscriptions: [category_id], in_app: bool }` | `subscriptions`, `user_preferences` |
| PUT | `/api/users/:id/subscriptions/:cid` | `{ subscribed: bool }` | `{ ok: true }` | INSERT … ON CONFLICT DO NOTHING / DELETE (audited) |
| PUT | `/api/users/:id/in-app` | `{ enabled: bool }` | `{ ok: true }` | Upsert into `user_preferences` |
| POST | `/api/notifications` | `{ sender_id, category_ids: [int], title, body, priority?, expires_at? }` | `{ results: [{ category_id, notification_id, recipients }] }` | `send_notification()` per category, all in **one transaction** |
| GET | `/api/stats` | — | `{ totals, categories, departments, senders, priority }` | The 3 stats views + 2 aggregate queries |
| GET | `/api/audit` | — | Latest 100 `audit_log` rows | `audit_log` |
| POST | `/api/query` | `{ sql, allowWrites? }` | `{ command, rowCount, columns, rows, ms }` | SQL Playground (see below) |

Example:

```bash
curl -X POST http://localhost:3000/api/notifications \
  -H "Content-Type: application/json" \
  -d '{"sender_id":2,"category_ids":[1,7],"title":"Lab moved","body":"Lab 3 from today","priority":"high"}'
```

---

## SQL Playground and its safety rules

`POST /api/query` runs one statement typed in the browser. Because the app may sit on a public URL,
these guards are in place:

1. **Read-only by default.** The query runs in `BEGIN READ ONLY` and is always rolled back, so
   INSERT / UPDATE / DELETE fail. Turning on **Allow writes** uses a normal `BEGIN … COMMIT`.
2. **One statement only.** The query is sent with Postgres's *extended protocol* (`queryMode: 'extended'`),
   which rejects multiple statements. Tricks like `SELECT 1; COMMIT; DROP TABLE users;` are refused
   by Postgres itself.
3. **Blocked keywords, even with writes on:** `DROP`, `TRUNCATE`, `ALTER`, `CREATE`, `GRANT`, `REVOKE`,
   `COPY`, `DO`, `VACUUM`, `REINDEX`, `CLUSTER`, `COMMENT`, `SECURITY`, `LOCK`, `LISTEN`, `NOTIFY`, plus
   statements starting with `SET`, `RESET` or `DISCARD`. Comments and string literals are stripped
   before checking, so `SELECT 'drop'` still works. A column or alias that happens to use one of
   these words (e.g. `AS comment`) is also blocked; rename it.
4. **5-second timeout** (`SET LOCAL statement_timeout = '5s'`), so a runaway query can't hog the database.

See the next section for what these guards **don't** protect against.

---

## Security model and known limitations

NotifyHub is a **classroom demo**, not a production system. Before you share the public URL, it's
important to be clear about what it does *not* protect.

### There is no login

- The **Viewing as** and **From** pickers are just dropdowns. The server trusts whatever `user_id` /
  `sender_id` the browser sends, so **anyone with the URL can act as any user**, including the admin
  or a faculty member.
- The `trg_check_sender_role` trigger stops **student accounts** from posting. It can't stop a
  student from *picking a faculty name* and posting as them, because the database has no idea who
  is actually at the keyboard.

### "Allow writes" in the Playground is powerful

With writes enabled, a visitor can run any single INSERT / UPDATE / DELETE, for example
`UPDATE users SET role = 'admin' WHERE user_id = 7`, `DELETE FROM notifications`, or posting spam.
The keyword blocklist only prevents *schema* damage (DROP, ALTER, TRUNCATE…), not data changes, and
a keyword blocklist is never a real security boundary.

### Other gaps

- No rate limiting, so a script could post thousands of notices.
- No input length limits beyond the schema's (`title` ≤ 200 characters; `body` is unlimited TEXT).
- The app's database user owns all the tables, so there are no Postgres-level permissions in play.

### What keeps it reasonably safe for a demo

- Notice text is HTML-escaped everywhere in the UI, so posted content can't inject scripts.
- All API queries use parameterised SQL (`$1, $2…`), so form input can't cause SQL injection.
- Schema-destroying statements are blocked, and anything else can be undone with `npm run setup`.

### What a production version would need

| Problem | Fix |
|---|---|
| Anyone can be anyone | Real authentication (sessions or JWT, or SSO with the college Google account). The server takes `user_id` / `sender_id` from the session, **never** from the request body |
| Students posting as faculty | Follows from the fix above. Also check category ownership (e.g. only CSE faculty post to *CSE Department*) |
| Playground writes | Turn it off in production with an env var, or point it at a role with `GRANT SELECT` only |
| Least privilege in Postgres | Separate DB roles: the app role gets `EXECUTE` on the functions and `SELECT` on the views, not raw table access. Add **row-level security** so a user only sees their own `notification_recipients` rows |
| Spam | Rate limiting per user/IP (e.g. `express-rate-limit`), length limits, and moderation for urgent notices |
| Auditing who acted | Store the authenticated user id in `audit_log` (e.g. via `SET LOCAL app.user_id` read by the trigger) |

---

## DBMS concepts: where to find them

| Concept | Where |
|---|---|
| PK, FK, UNIQUE, NOT NULL, CHECK | `01_schema.sql`, e.g. `CHECK (read_at >= delivered_at)` |
| Referential actions | `ON DELETE CASCADE` (subscriptions), `SET NULL` (users.dept_id), `RESTRICT` (notification sender) |
| **Trigger: fan-out** | `trg_fan_out_notification`: one INSERT creates a row for every subscriber; urgent notices bypass mute |
| Trigger: business rule | `trg_check_sender_role`: students can't send |
| Trigger: derived data | `trg_sync_read_at`: sets `read_at` when status becomes `read` |
| Trigger: auditing | `trg_audit_*`: one generic function reused on 3 tables via `TG_ARGV` |
| Functions | `send_notification()`, `unread_count()` |
| Stored procedures | `CALL mark_all_read(id)`, `CALL archive_expired()` |
| Views | `user_inbox`, `category_stats`, `dept_engagement`, `sender_stats` |
| Indexes | Composite `(user_id, status)`, **partial** `WHERE status='unread'`, `(category_id, created_at DESC)` |
| Transactions | Sending to several categories is one transaction (`server.js`): if one fails, nothing is sent. `SAVEPOINT` demo in Q15 |
| Read-only transactions | The SQL Playground runs in `BEGIN READ ONLY` |
| Joins, GROUP BY / HAVING | Q8, Q10 |
| Subqueries, EXISTS / NOT EXISTS | Q9 (anti-join) |
| Window functions | Q6 `RANK`, Q7 running `SUM`, Q11 `ROW_NUMBER` |
| Set operations / relational division | Q12 (`EXCEPT` inside `NOT EXISTS`) |
| Query optimisation | Q14 `EXPLAIN ANALYZE` shows the partial index being used |

## Demo queries (05_demo_queries.sql)

| # | Query | Concept |
|---|---|---|
| Q1 | A user's inbox | View |
| Q2 | Unread count | Function |
| Q3 | Send a notice and watch it fan out | Function + trigger |
| Q4 | A student tries to send (fails) | Trigger raising an error |
| Q5 | Mark all read | Stored procedure |
| Q6 | Category engagement leaderboard | View + `RANK()` |
| Q7 | Daily volume with running total | Window `SUM()` |
| Q8 | Average time-to-read by priority | Aggregates on intervals |
| Q9 | Students who never read anything | Anti-join with `NOT EXISTS` |
| Q10 | Notices read by at least 90% | `GROUP BY` + `HAVING` |
| Q11 | Latest notice per category | `ROW_NUMBER()` partition |
| Q12 | Students subscribed to every optional category | Relational division |
| Q13 | Department engagement | View |
| Q14 | Index in action | `EXPLAIN ANALYZE` |
| Q15 | All-or-nothing transaction | `BEGIN` / `SAVEPOINT` / `ROLLBACK` |
| Q16 | Audit trail | Rows written by triggers |

---

## Demo script for the evaluation

About 8 minutes.

1. **Inbox.** In *Viewing as*, pick **Siddharth Paul**. Show the unread items, then click one to mark
   it read. Point out that `read_at` was set by a trigger.
2. **Compose.** From **Dr. Meera Iyer**, select *CSE Department* and *Coding Club*, then send. The
   message says "delivered to N recipients": that's the **fan-out trigger**. Go back to the Inbox and
   the notice is there.
3. **Compose as a student.** Pick a student under *Students (will be rejected)*. The trigger rejects
   it and the whole **transaction rolls back**.
4. **Urgent bypass.** In the Inbox, switch off *In-app notifications* for Siddharth. Send an **urgent**
   notice to *CSE Department*. It still arrives because of the urgent-bypass rule in the trigger.
5. **Mark all read** calls the stored procedure.
6. **Analytics.** Every table on this page is a **view**.
7. **SQL Playground.** Run the window-function, relational-division and **EXPLAIN ANALYZE** presets.
8. **Audit Log.** Every insert and delete you just made was logged by triggers.

Reset beforehand with `npm run setup` so the numbers and the audit log start clean.

## Likely viva questions

- **Why triggers instead of app code?** The rules hold whoever writes to the database (the app,
  psql, another service). You can't bypass them.
- **What happens if fan-out fails halfway?** The trigger runs in the same transaction as the
  INSERT, so either the notice and all its deliveries are saved, or none are.
- **Why a partial index?** Unread rows are a small fraction of the table, so indexing only those
  keeps the index tiny and unread counts fast.
- **Function vs procedure?** A function returns a value and can be used inside `SELECT`. A procedure
  is called with `CALL`, returns nothing, and can manage transactions.
- **Why fan-out on write instead of on read?** Reads (inbox views) happen far more often than
  writes, and each delivery needs its own status and read time.
- **Why is `sender_id` ON DELETE RESTRICT?** Deleting a faculty member shouldn't silently delete
  every notice they posted. You have to deal with their notices first.
- **Why does `audit_log` have no foreign keys?** It must keep history even after the original row
  is deleted.
- **Can a student post by picking a faculty name?** Yes, because there's no authentication in this
  demo. The trigger checks the *claimed* sender's role. See
  [Security model](#security-model-and-known-limitations) for the fix.
- **What would you add with more time?** Authentication, email/SMS delivery workers using
  `SELECT … FOR UPDATE SKIP LOCKED`, monthly partitioning of `notification_recipients`, and
  row-level security.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `password authentication failed` | Wrong password. Re-copy the Neon string, or set `$env:PGPASSWORD` correctly |
| `ECONNREFUSED 127.0.0.1:5432` | Local PostgreSQL isn't running. Open `services.msc`, find `postgresql-x64-…` and click Start, or use a Neon `DATABASE_URL` instead |
| `Could not reach the database` on start, then exit | `DATABASE_URL` is wrong or missing on Render. Check the environment variable |
| `self-signed certificate` / SSL errors locally | Use the exact Neon string including `?sslmode=require`. For a local server, use `localhost` in the URL so SSL is switched off |
| Port 3000 already in use | Run `$env:PORT=3001; npm start` |
| The first page load on Render takes about a minute | The free instance was asleep. Expected; see the free-tier notes |
| `Idle DB connection closed` in the logs | Neon suspended an idle connection. Harmless: it's logged, and the next request reconnects |
| UI shows old names / old data | The database was built from an older seed. Run `npm run setup` |
| Playground says "Blocked in the playground…" | The query contains a blocked keyword (maybe as an alias, e.g. `AS comment`). Rename it |
| Playground says "Run one statement at a time" | Remove the extra statements after the first `;` |
| Inbox is empty for a user | They have no subscriptions. Turn some on in the right-hand column |

## Future work

- Login (college SSO) with the session deciding who you are, plus per-category posting rights.
- Email/SMS delivery workers driven by `user_preferences` and `FOR UPDATE SKIP LOCKED` queues.
- Partitioning `notification_recipients` by month, plus a scheduled `CALL archive_expired()` (`pg_cron`).
- Row-level security so each user can only read their own deliveries.
- Real-time inbox updates with Postgres `LISTEN/NOTIFY` and server-sent events.
