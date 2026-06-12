# Defect Registry & Bug Log

This document serves as the persistent audit log of all discovered application defects, root cause analyses, and the regression tests implemented to prevent them from recurring.

---

## [BUG-001] Frontend Mock Fetch Failure in App Integration Tests

### Description
The frontend integration test suite inside `frontend/src/App.test.tsx` fails when calling "Authorize & Fetch" because the original `/api/gmail/fetch` endpoint was split into `/api/gmail/fetch-list` and `/api/gmail/fetch-detail`. The simplistic fetch mock returned the raw emails array for all requests, causing list fetching to resolve to `0` message IDs.

### Root Cause
The tests used a generic `vi.stubGlobal('fetch')` mock that did not handle conditional URLs. Splitting the fetch endpoint broke the expected payload schema of the API call, resulting in `0` raw receipt emails being loaded.

### Resolution
Refactored the fetch mocks in `App.test.tsx` to handle `/api/gmail/fetch-list`, `/api/gmail/fetch-detail`, `/api/gmail/raw-emails`, and other layers conditionally, returning the correct expected JSON shapes.

### Verification Test
* **Test Case**: `frontend/src/App.test.tsx`
  - *allows the user to manually review and move emails to transaction section*
  - *opens a modal displaying full content when clicking an email, and allows overrides*
  - *displays processed badge and disables extraction/checkbox for already processed emails*
  - *allows the user to filter bronze emails by processed and unprocessed status*

---

## [BUG-002] Raw Email Ingestion Status (hasTransaction) Reset on Reload

### Description
When a user manually shifts raw receipt emails between transactional and non-transactional sections (using "Mark Tx" / "Unmark Tx"), or when emails are fetched initially, refreshing the page resets all raw emails back to the "non-transactional" tab.

### Root Cause
1. The `bronze_raw_emails` table did not store a `has_transaction` column, so classification state was not persistent.
2. The manual review state update on the frontend was optimistic and only updated local React state, never syncing the classification back to the server database.

### Resolution
1. Conducted database migration to add `has_transaction INTEGER NOT NULL DEFAULT 1` to `bronze_raw_emails`.
2. Created a secure REST endpoint `PUT /api/gmail/raw-emails/:id` to persist classification changes.
3. Updated frontend hook to call the `PUT` endpoint asynchronously during optimistic state updates.

### Verification Test
* **Test Case**: `backend/tests/gmail.test.ts`
  - *should return raw emails with hasTransaction derived correctly from payload/subject*
  - *should update raw email transactional classification status successfully*

---

## [BUG-003] Ingestion Query Date Range Filter Failure due to Raw RFC-2822 Dates

### Description
Immediately after the Gmail fetch completes, the raw email list table displays `0` raw receipt emails. However, performing a manual page refresh (which resets the date filters) successfully loads the emails in the table.

### Root Cause
Gmail email dates are parsed from headers in RFC-2822 format (e.g. `'Thu, 11 Jun 2026 09:30:00 +0000'`). SQLite's `date()` function cannot parse RFC-2822 dates directly (returning `NULL`). When the frontend requested filtered emails with `startDate` and `endDate` parameters, the query `date(received_at) >= date(?)` failed to match any rows.

### Resolution
Updated `saveRawEmail` in `sqlite-transaction-repository.ts` to normalize all raw email dates into standardized ISO-8601 strings (via `new Date().toISOString()`) before saving them. This makes SQLite queries fully date-query compatible.

### Verification Test
* **Test Case**: `backend/tests/gmail.test.ts`
  - *should return raw emails with hasTransaction derived correctly from payload/subject* (verifies ISO format is stored and returned cleanly).
  - Existing date range filter tests in `transaction-pipeline.test.ts` and `gmail.test.ts`.

---

## [BUG-005] Redundant "Processed" UI Badge & Button on Bronze Screen

### Description
The Bronze (Raw Emails) screen displays a green "✓ Processed" badge next to the subject of emails that have already been processed. However, under the "Action" column of the same row, a disabled button with the label "Processed" is also displayed, causing duplicate "Processed" text indicators.

### Root Cause
In `BronzeEmailList.tsx`, when an email is determined to be processed via `isEmailProcessed(email)`, the action column render logic creates a disabled "Unmark Tx" button AND a disabled "Processed" button. The latter button is redundant as the email subject area already renders the custom "✓ Processed" status badge.

### Resolution
Removed the redundant disabled "Processed" button from the action column in `BronzeEmailList.tsx` for processed emails.

### Verification Test
* **Test Case**: `frontend/src/App.test.tsx`
  - *displays processed badge and disables extraction/checkbox for already processed emails*




