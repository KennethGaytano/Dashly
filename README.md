# Dashly

**A personal productivity dashboard that puts tasks, calendar, notes, goals, focus sessions, and progress in one place.**  
Sign in and your data follows you across devices; sign out and nothing is left behind.

[**Try Dashly live →**](https://dashly-lilac.vercel.app/)

---

## What is Dashly?

Dashly is a lightweight, offline-first dashboard for personal productivity. It runs entirely in your browser—no install, no setup. Create an account with email and password, and your tasks, events, notes, goals, and focus sessions sync to your private Supabase database. Open it on your laptop, phone, or tablet; everything stays in sync.

---

## Key Features

| Feature | What it does |
|---------|--------------|
| **Tasks** | Full to-do lists with due dates, priorities, descriptions, links, and a three-column Kanban board (To Do / In Progress / Done). Overdue tasks are flagged automatically. |
| **Calendar** | Month view with dot markers, a daily detail panel, and an upcoming-events list grouped by day. Add, edit, or delete events in seconds. |
| **Notes** | Rich notes with a colour picker. A Quick Note shortcut on the Home page opens the full editor; recent notes surface on the dashboard. |
| **Goals** | Set goals with milestone checklists. Progress recalculates as you tick milestones; a goal completes when all milestones are done, when you mark it complete, or when progress hits 100 %. |
| **Progress** | Rolling seven-day stats: tasks completed, hours studied, Pomodoros, and day streak. Plus Skills & Learning and Project Completion trackers that advance along an eight-step ladder. |
| **Pomodoro** | Focus and Break timers (1–120 minutes). Sessions only log when a block actually finishes—pausing early records nothing. Timer state survives a refresh. |
| **Cross-device sync** | Changes appear on your other open tabs and devices in real time via Supabase Realtime. |
| **Light & dark themes** | First visit follows your device preference; your manual choice is saved for next time. |

---

## How it works

- **Offline-first** — Data lives in your browser for instant reads. Writes sync to Supabase in the background.
- **Your account, your data** — Sign up with your first name, last name, username, email, and password. Profile details are saved with your Supabase account; update your first name, last name, or username later in Account settings. Dashboard records are protected by Row Level Security.
- **Account settings** — Edit your first name, last name, and username; change your password after confirming your current password; sign out to create or switch accounts; or permanently delete your account and synced dashboard data.
- **Dedicated settings page** — Open Settings from the dashboard navigation to manage profile details, password, account switching, and account deletion in one place.
- **No installation** — Open the link and start. It works on any modern browser, desktop or mobile.

---

## Get started

1. Open [**Dashly**](https://dashly-lilac.vercel.app/)
2. Click **Sign up**, then enter your first name, last name, username, email,
   and password.
3. Start adding tasks, events, notes, and goals. Everything saves automatically.

---

## Sign in with a username

After creating an account, sign in with your username and password. Existing
accounts can use their email address in the Username field once, then open
Account settings to add a username; after that they can sign in with it.

Username sign-in uses the `sign-in-with-username` Supabase Edge Function to
look up the account privately and returns a session only after the password is
verified. Deploy it to the project:

```bash
npx supabase functions deploy sign-in-with-username --project-ref zdmbbdxynpmhmuvqlzjf
npx supabase functions deploy delete-account --project-ref zdmbbdxynpmhmuvqlzjf
```

---

## Privacy

Your data never leaves your Supabase account. The dashboard itself stores nothing—no analytics, no tracking, no third-party cookies. You control the Supabase project; you can export or delete your data at any time.
