# CBT & Report Card Guide — School Connect Gen v8

## CBT (Computer-Based Testing)
- Engine: `assets/js/cbt-engine.js` (17 question types, anti-cheat config, instant scoring, certificate codes).
- Schema: **`database/complete-schema.sql` (v12.5)** — the only SQL a deployment needs. It ships the student-safe fetch RPCs `cbt_get_public_exam` / `cbt_get_public_exam_v2` (answers/explanations stripped server-side), the server-graded submit RPCs `cbt_submit` / `cbt_submit_v2` (attempt limits, close-window, shuffle-safe `_orig_index` grading, idempotent retries via `client_ref`), and `cbt_import_backup` (teacher-side import of offline backup files). Question banks live in `cbt_exams.csv_data` (legacy `cbt_exams.questions` is honoured as a fallback).
- Pages: `assets/templates/pages/cbt.html`, `cbt-exam.html`, `cbt-multi.html`, `cbt-prompts.html`, `entrance.html`.
- Question import: CSV upload (see `database/sample-question-bank.csv`, `database/sample-questions.csv` and `database/further_maths_sample.csv`).
- Anonymous/entrance mode: guests can sit entrance exams; results, certificates and admission letters are generated instantly (single + bulk).
- Offline resilience: a candidate whose submission is blocked (network drop, expired window) hands the teacher their backup file; the teacher imports it on the CBT page and `cbt_import_backup` grades it server-side exactly like a live submission.

## Report Cards
- Engine: `assets/js/report-engine.js` — report card, broadsheet and scoresheet outputs.
- Schema: `database/complete-schema.sql` (same single file; results/report tables, triggers and policies included).
- Page: `assets/templates/pages/report-cards.html` — branded, printable, includes digital-library reading marks.

## Flow
1. Teacher creates exam (CBT page) → students take it (cbt-exam) →
2. Scores pushed to report cards from the **Report Engine → “Push CBT Scores → Report Card”** button (`ReportEngine.openCBTExportModal()` / `doCBTExport()` — choose the target results column; upserts idempotently) →
3. Report cards printed / broadcast to parents (WhatsApp / email / SMS).
4. Punctuality Points can likewise be pushed into a chosen term-results column (`sc_push_punctuality_to_results`) from the Punctuality page.
