# Class script

About 6½ minutes. Press **F** for full screen, then **T** to start the timer. Green means you are between 5:00 and 7:00. Red means you went over. **→** moves to the next slide. **N** shows these notes on screen.

## Open (15s)

- Hi, I'm Brady. This is UPlanner, a homework planner I built from scratch.
- It runs in the browser. No account, no install.
- The yellow note is live. Those numbers are my real homework list.

## The problem (20s)

- Homework usually lives in five places: Classroom, texts, the board, a sticky note, your head.
- I wanted one tab.

## 1. Live demo (2 min)

Ask for a volunteer. Click each step when you finish it.

- **Add one.** Volunteer names an assignment. Click the planner and press **n**. Type it in and save. The open count on the left goes up.
- **Check one off.** Click Done on something on the dashboard.
- **Open a day.** Click a day on the week strip. That jumps to the calendar.
- **Start the timer.** Go to Timer and press start. It counts down to a set end time, so a slow tab does not drift.
- **Average two scores.** Volunteer gives two tests. Add them on Grades. The letter grade updates.
- **Phone.** Click the phone icon. Same app, phone layout.

## 2. Tech specs (1 min)

- Three files: HTML, CSS, and JavaScript. No framework, no server, no account, no cost.
- Everything saves in this browser.
- Pick two cards:
  - The URL picks the page. `#calendar` is the calendar.
  - The timer stores an end time and subtracts `Date.now()`, so it stays accurate.
- It took four looks to get here. The first one looked like a template. Each version got quieter.

## 3. Teach the class (1½ min)

- Your browser has a database. It is called localStorage.
- Hand the laptop over. Have someone type a note on the sticky, then press **reload the page**.
- The note is still there. That is the whole trick.
- Lists have to become text first, which is what `JSON.stringify` does.
- Next slide is the real database: every assignment, as JSON. Press **add one from here** and it shows up in the planner too.

## Close (20s)

- Questions? The QR code opens UPlanner on your phone.
- Delete the demo assignments after class if you do not want them saved.
