-- =====================================================================
-- NotifyHub — 04_seed.sql
-- Realistic sample data: 5 departments, 200 users, 8 categories,
-- ~30 notifications over the last 30 days. Deterministic (setseed).
-- =====================================================================

SELECT setseed(0.42);

INSERT INTO departments (name) VALUES
    ('Computer Science'),        -- 1
    ('Electronics'),             -- 2
    ('Mechanical'),              -- 3
    ('Training & Placement'),    -- 4
    ('Hostel Office');           -- 5

-- Named users (ids 1-20)
INSERT INTO users (name, email, role, dept_id) VALUES
    ('Admin Office',      'admin@college.edu',       'admin',   NULL),  -- 1
    ('Dr. Meera Iyer',    'meera.iyer@college.edu',  'faculty', 1),     -- 2
    ('Dr. Rajesh Kumar',  'rajesh.kumar@college.edu','faculty', 2),     -- 3
    ('Prof. Anil Verma',  'anil.verma@college.edu',  'faculty', 3),     -- 4
    ('Neha Kapoor (TPO)', 'tpo@college.edu',         'faculty', 4),     -- 5
    ('Suresh Patil',      'warden@college.edu',      'faculty', 5),     -- 6
    ('Siddharth Paul',    'siddharth@college.edu',   'student', 1),     -- 7
    ('Anshika Pandey',    'anshika@college.edu',     'student', 1),
    ('Bhavesh',           'bhavesh@college.edu',     'student', 1),
    ('Dhwanit Vyas',      'dhwanit@college.edu',     'student', 1),
    ('Kunal',             'kunal@college.edu',       'student', 2),
    ('Rohan Desai',       'rohan@college.edu',       'student', 2),
    ('Priya Nair',        'priya@college.edu',       'student', 2),
    ('Vikram Joshi',      'vikram@college.edu',      'student', 3),
    ('Sneha Kulkarni',    'sneha@college.edu',       'student', 3),
    ('Arjun Reddy',       'arjun@college.edu',       'student', 3),
    ('Diya Malhotra',     'diya@college.edu',        'student', 1),
    ('Ananya Gupta',      'ananya@college.edu',      'student', 2),
    ('Pooja Yadav',       'pooja@college.edu',       'student', 3),
    ('Harsh Agarwal',     'harsh@college.edu',       'student', 1);

-- Bulk students (ids 21-200), spread across the 3 academic departments
INSERT INTO users (name, email, role, dept_id)
SELECT 'Student ' || LPAD(g::TEXT, 3, '0'),
       'student' || g || '@college.edu',
       'student',
       (g % 3) + 1
FROM generate_series(21, 200) AS g;

INSERT INTO categories (name, description, owner_dept_id) VALUES
    ('CSE Department',  'Notices from the Computer Science department', 1),  -- 1
    ('ECE Department',  'Notices from the Electronics department',      2),  -- 2
    ('ME Department',   'Notices from the Mechanical department',       3),  -- 3
    ('Placements',      'Drives, deadlines and results',                4),  -- 4
    ('Hostel',          'Mess, maintenance and hostel rules',           5),  -- 5
    ('Exams',           'Timetables, hall tickets, results',            NULL),-- 6
    ('Coding Club',     'Contests, workshops and hackathons',           1),  -- 7
    ('Sports',          'Tournaments and trials',                       NULL);-- 8

-- Every student follows their own department's category
INSERT INTO subscriptions (user_id, category_id, subscribed_at)
SELECT user_id, dept_id, now() - INTERVAL '60 days'
FROM users WHERE role = 'student';

-- Everyone (students) gets Exams
INSERT INTO subscriptions (user_id, category_id, subscribed_at)
SELECT user_id, 6, now() - INTERVAL '60 days'
FROM users WHERE role = 'student';

-- Optional categories with different popularity
INSERT INTO subscriptions (user_id, category_id, subscribed_at)
SELECT u.user_id, x.category_id, now() - INTERVAL '45 days'
FROM users u
CROSS JOIN (VALUES (4, 0.75), (5, 0.55), (7, 0.35), (8, 0.30)) AS x(category_id, p)
WHERE u.role = 'student'
  AND (random() < x.p OR (u.user_id = 7 AND x.category_id IN (4, 7)));

-- Faculty follow Exams + Placements
INSERT INTO subscriptions (user_id, category_id, subscribed_at)
SELECT u.user_id, c, now() - INTERVAL '60 days'
FROM users u CROSS JOIN (VALUES (4), (6)) AS v(c)
WHERE u.role = 'faculty'
ON CONFLICT DO NOTHING;

-- Preferences: everyone has in_app; ~6% have muted it; ~60% use email
INSERT INTO user_preferences (user_id, channel, enabled)
SELECT user_id, 'in_app', NOT (random() < 0.06 AND user_id > 20) FROM users;
INSERT INTO user_preferences (user_id, channel, enabled)
SELECT user_id, 'email', random() < 0.6 FROM users;

-- Notifications (the fan-out trigger creates recipient rows automatically)
INSERT INTO notifications (sender_id, category_id, title, body, priority, created_at, expires_at) VALUES
 (1, 6, 'Mid-sem exam timetable released', 'The mid-semester timetable is now on the portal. Check your slots.', 'high',   now() - INTERVAL '29 days', NULL),
 (2, 1, 'DBMS lab moved to Lab 3',          'From this week the DBMS lab will run in Lab 3, 2nd floor.',        'normal', now() - INTERVAL '28 days', NULL),
 (5, 4, 'Infosys drive registration open',  'Eligible: CGPA 6.5+. Register on the placement portal by Friday.',  'high',   now() - INTERVAL '27 days', NULL),
 (6, 5, 'Mess menu updated',                'New mess menu applies from Monday. Feedback form in the hostel office.', 'low', now() - INTERVAL '26 days', NULL),
 (3, 2, 'VLSI guest lecture',               'Guest lecture on VLSI design trends, Seminar Hall, 3 PM Thursday.', 'normal', now() - INTERVAL '25 days', NULL),
 (2, 7, 'Weekly contest #12',               'Coding Club weekly contest this Saturday 8 PM on Codeforces gym.', 'normal', now() - INTERVAL '24 days', NULL),
 (4, 3, 'Workshop safety briefing',         'Mandatory safety briefing before workshop sessions resume.',      'high',   now() - INTERVAL '23 days', NULL),
 (1, 8, 'Inter-college cricket trials',     'Trials on the main ground, 7 AM Sunday. Bring your own kit.',     'low',    now() - INTERVAL '22 days', NULL),
 (5, 4, 'TCS NQT mock test',                'Mock test in CSE labs. Seats are limited.',                       'normal', now() - INTERVAL '21 days', NULL),
 (6, 5, 'Water supply interruption',        'Water supply off in Block B from 10 AM to 2 PM tomorrow.',        'urgent', now() - INTERVAL '20 days', NULL),
 (1, 6, 'Hall tickets available',           'Download your hall ticket from the student portal.',              'high',   now() - INTERVAL '19 days', NULL),
 (2, 1, 'Project groups due',               'Submit your DBMS project groups (max 3) by Monday.',              'high',   now() - INTERVAL '18 days', NULL),
 (5, 4, 'Infosys shortlist',                'Shortlisted candidates are on the placement portal.',             'high',   now() - INTERVAL '17 days', NULL),
 (2, 7, 'Hackathon team formation',         'Internal hackathon next month. Form teams of 4.',                 'normal', now() - INTERVAL '16 days', NULL),
 (3, 2, 'Microprocessor lab rescheduled',   'Thursday lab moved to Friday 10 AM.',                             'normal', now() - INTERVAL '15 days', NULL),
 (4, 3, 'CAD assignment extension',         'CAD assignment deadline extended by one week.',                   'low',    now() - INTERVAL '14 days', NULL),
 (6, 5, 'Hostel room inspection',           'Routine room inspection this Wednesday.',                         'normal', now() - INTERVAL '12 days', NULL),
 (5, 4, 'Amazon SDE intern drive',          'Amazon SDE intern drive for 3rd years. Resume deadline Sunday.',  'urgent', now() - INTERVAL '10 days', NULL),
 (1, 6, 'Mid-sem results published',        'Results are on the portal. Re-evaluation window: 5 days.',        'high',   now() - INTERVAL '9 days',  NULL),
 (2, 7, 'Weekly contest #14',               'Contest this Saturday. Editorial session on Sunday.',             'normal', now() - INTERVAL '8 days',  NULL),
 (1, 8, 'Sports week schedule',             'Sports week schedule released. Registrations open.',              'normal', now() - INTERVAL '7 days',  NULL),
 (3, 2, 'ECE project expo',                 'Project expo submissions open for final-year projects.',          'normal', now() - INTERVAL '6 days',  NULL),
 (2, 1, 'DBMS project evaluation dates',    'Final DBMS project evaluations are next week. Slots on the portal.', 'urgent', now() - INTERVAL '5 days', NULL),
 (5, 4, 'Google STEP info session',         'Info session for Google STEP, Auditorium, 4 PM.',                 'normal', now() - INTERVAL '4 days',  NULL),
 (6, 5, 'Diwali leave: hostel closing',     'Hostel closes for Diwali break. Submit your leave forms.',        'high',   now() - INTERVAL '3 days',  NULL),
 (4, 3, 'Thermal lab viva',                 'Thermal lab viva on Monday as per roll numbers.',                 'normal', now() - INTERVAL '2 days',  NULL),
 (1, 6, 'End-sem form fill-up',             'End-semester exam forms must be filled by the 20th.',             'high',   now() - INTERVAL '1 day',   now() + INTERVAL '10 days'),
 (2, 7, 'Weekly contest #15',               'Contest tonight 8 PM!',                                           'normal', now() - INTERVAL '5 hours', now() + INTERVAL '1 day'),
 (5, 4, 'Microsoft drive: last call',       'Last day to apply for the Microsoft drive.',                      'urgent', now() - INTERVAL '2 hours', now() + INTERVAL '2 days'),
 (6, 5, 'Old notice (expired)',             'Laundry service closed last weekend.',                            'low',    now() - INTERVAL '11 days', now() - INTERVAL '8 days');

-- Simulate reading behaviour: urgent/high get read more, and faster
UPDATE notification_recipients nr
SET status  = 'read',
    read_at = LEAST(nr.delivered_at + (random() * x.max_hours) * INTERVAL '1 hour', now())
FROM notifications n,
     LATERAL (SELECT CASE n.priority WHEN 'urgent' THEN 0.95 WHEN 'high' THEN 0.8
                                     WHEN 'normal' THEN 0.6 ELSE 0.35 END AS p,
                     CASE n.priority WHEN 'urgent' THEN 6 WHEN 'high' THEN 24
                                     WHEN 'normal' THEN 48 ELSE 96 END AS max_hours) x
WHERE n.notification_id = nr.notification_id
  AND random() + 0 * nr.user_id < x.p;   -- "+ 0*nr.user_id" forces a fresh random per recipient row

-- A few "ghost" students who never read anything (for the anti-join demo, Q9)
UPDATE notification_recipients SET status = 'unread'
WHERE user_id BETWEEN 193 AND 200;

-- Archive whatever has expired
CALL archive_expired();

-- Start the demo with a clean audit log
TRUNCATE audit_log RESTART IDENTITY;
