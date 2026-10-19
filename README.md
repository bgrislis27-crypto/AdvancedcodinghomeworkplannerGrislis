# StudyHub

StudyHub is a homework planner that runs entirely in your browser. It keeps assignments, grades, a study timer, and your theme on this device. There is no account, server, or external service.

## Run it

Open `index.html` in a current version of Chrome, Firefox, Safari, or Edge.

From this folder you can also start a tiny local server:

```bash
python3 -m http.server 8080
```

Then visit `http://localhost:8080`.

## What you can do

- See homework totals, your grade average, progress, an analytics chart, upcoming work, and a homework table on the dashboard.
- Add an assignment with a title, subject, description, due date, priority, and estimated time.
- Edit an assignment, delete it, or mark it complete. Sample assignments are included and can be changed or removed.
- Browse a month calendar and open any day to see what is due.
- Filter by subject, priority, completed or active tasks, and work due today or later. Search matches the title, subject, and description.
- Watch a completion ring, due-date rings, and a chart of how many assignments are due each week, month, or year.
- Run a Pomodoro timer with focus, short break, and long break modes. Start, pause, and reset all work, and the session length is saved.
- Enter grades and see a letter and a numeric average. Weights are optional.
- Switch between light and dark themes. Light is the default until you change it.

Your name stays in this browser only. The circle in the top bar shows its first letter, and you can change the name from there.

## Where data is saved

StudyHub uses the browser's local storage:

- `studyhub.assignments`
- `studyhub.grades`
- `studyhub.prefs` (theme, name, timer lengths, and today's focus-session count)

Clearing site data for this page removes those records. **Restore samples** on the Assignments page puts the original assignment set back without touching grades or preferences.

The first visit loads realistic sample assignments with dates relative to today, so overdue and upcoming items stay meaningful. If you delete them all, they stay gone until you restore the samples.
