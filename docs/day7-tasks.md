# Day 7 — present it

New today (no code changes, all documentation):
- `README.md`: the project's front page, with screenshots, results and diagrams
- `docs/architecture.md`: 5 diagrams that GitHub draws from text (Mermaid)
- `docs/adr/`: 5 short design decisions, each with its trade-offs
- `docs/scaling.md`: how it would scale, using YOUR load-test numbers
- `docs/interview-prep.md`: a 30-second pitch, a 5-minute demo, 30 questions with answers
- `docs/images/`: screenshots used by the README

---

## Task 1 — Push and look at it on GitHub (5 min)

```bash
git add .
git commit -m "Day 7: README, architecture, ADRs, scaling, interview prep"
git push
```
Open **https://github.com/revant123/quickkart**. The README shows with screenshots.
Then open `docs/architecture.md` on GitHub: the diagrams are drawn automatically.

## Task 2 — Polish the GitHub page (5 min)

On the repo page, click the ⚙ next to **About** (right side):
- Description: `Multi-store quick-commerce platform: race-safe checkout, idempotent orders, Redis caching, Docker, load-tested with k6`
- Topics: `react` `typescript` `nodejs` `express` `postgresql` `redis` `docker` `k6` `system-design`

If the repository is private and you want to show it to recruiters, make it public:
Settings → General → scroll to **Danger Zone** → **Change visibility**.
(Check first that `.env` was never committed: it isn't in your repo, `.gitignore` excludes it.)

## Task 3 — Optional: replace screenshots with your own (10 min)

The screenshots in `docs/images/` came from Claude's test run. To use your own:
on your Mac press **Cmd+Shift+4**, drag over the browser window, then drag the file into
`docs/images/` in VS Code with the same name (e.g. `shop.png`), replacing the old one.

## Task 4 — Read and practise (1–2 hours, the most valuable part)

1. Read `docs/interview-prep.md` once.
2. Say the **30-second pitch** out loud three times without reading it.
3. Do the **5-minute demo** once, with the app running, timing yourself.
4. Read `docs/architecture.md` section 4 (checkout) next to `api/src/modules/orders/placeOrder.ts`.

## Task 5 — Mock interview with Claude

Tell Claude: **"mock interview"**. Claude will ask the questions one at a time, like an
interviewer, and give feedback on each answer: what was right, what was missing, and a
stronger version. Answer in your own words, without looking at the notes.

---

## You're done when

- The README on GitHub shows the screenshots and the race-condition output.
- You can give the pitch and the demo without notes.
- You can answer questions 1, 2, 7, 12, 17 and 28 from `interview-prep.md` from memory.
  Those six come up most.
