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

---

## [BUG-006] Fetcher Config Filter Panel Visible Across All Tabs

### Description
The "Fetcher Config" panel (fetching filter) is displayed constantly on all medallion tabs (Bronze, Silver, and Gold), occupying valuable layout space when managing staging queue (Silver) and confirmed ledger (Gold) records.

### Root Cause
In `GmailIntegration.tsx`, the `<FilterPanel>` component was placed adjacent to the tab lists within the layout grid without tab-dependent conditional rendering.

### Resolution
Wrapped the `<FilterPanel>` block inside a conditional statement matching `isBronzeActive`. Furthermore, the content column styling was adjusted to scale dynamically from 4/5ths width (`xl:col-span-4`) to full width (`xl:col-span-5 w-full`) when the filter panel is hidden.

### Verification Test
* **Test Case**: `frontend/src/App.test.tsx`
  - *displays the Fetcher Config panel only on the Bronze tab and hides it on Silver and Gold tabs*

---

## [BUG-007] Silver Pipeline Status Discrepancy & Missing Staging Rejection Option

### Description
In the Medallion Pipeline, when a user approves Silver staging transactions to the Gold ledger, the status badge and counts in the staging list still display them as pending. Additionally, the dashboard displays approved and rejected transactions as pending, and there is no user option to reject staging transactions.

### Root Cause
1. The backend endpoint `/api/pipeline/silver-transactions` returns all extracted transactions (including approved ones). The staging list and the dashboard pending counts do not filter out the approved status.
2. The `updatePendingTransaction` SQL update method in the repository did not accept or update the `status` column directly when provided in the updates payload, instead dynamically computing it as 'pending' or 'error' and overriding user-rejections.
3. The details view modal (`EmailDetailModal.tsx`) did not render a "Reject" button or handle the rejected status.

### Resolution
1. Modified the repository to allow updating `status` directly to `'rejected'`.
2. Filtered out `'approved'` transactions in the visible list, and corrected the dashboard to only count `'pending'` or `'error'` statuses.
3. Added a "Reject" button inside `EmailDetailModal.tsx` and updated the UI layout to display rejected items with status badges cleanly.

### Verification Test
* **Test Case**: `backend/tests/gmail.test.ts`
  - *should support updating a pending transaction to rejected status and persisting it*
* **Test Case**: `frontend/src/App.test.tsx`
  - *allows the user to reject a staging transaction from the detail view modal and updates counts*

---

## [BUG-008] Delete Signature Mismatch for Manual Gold Ledger Entries on Ledger Page

### Description
On the Ledger page (`/transactions`), clicking the "Delete" button inside the details modal for a manual Gold ledger entry displays a confirmation modal with the incorrect "Revert to Staging" header/description and fails to delete/revert the record upon confirmation.

### Root Cause
The `EmailDetailModal` component's `onDeleteClick` prop expects the signature `(stage: 'bronze' | 'silver' | 'gold', lineage: { bronzeId?: string; silverId?: string; goldId?: string }) => void`.
However, the Ledger page `GoldTransactions.tsx` passes `handleGoldDeleteClick` which has the signature `(tx: GoldTransaction) => void`.
When `onDeleteClick('gold', lineage)` is triggered, the argument `'gold'` is bound to `tx`, making `tx.sourceType` and all other fields `undefined`. Consequently, `isDeleteManual` is set to `false`, and the deletion lineage is set to empty values, which causes the confirmation modal to display "Revert to Staging" and make an invalid API call.

### Resolution
Refactored `handleGoldDeleteClick` in `GoldTransactions.tsx` to accept both direct `GoldTransaction` object and `(stage, lineage)` parameters. When called with `(stage, lineage)`, it correctly determines whether the transaction is manual by looking it up in the `goldTransactions` list, setting `isDeleteManual` and `deleteLineage` appropriately.

### Verification Test
* **Test Case**: `frontend/src/App.test.tsx`
  - *supports deleting manual Gold transactions directly from the Ledger page details modal [BUG-008]*

---

## [BUG-009] Automatic Re-seeding of Deleted Payment Methods & Rules

### Description
When a user deletes all payment methods and rules, they are automatically recreated (re-seeded) by the database on the next query/load.

### Root Cause
In `getPaymentMethods(userId)` inside `sqlite-transaction-repository.ts`, if the count of payment methods for the user is `0`, the repository assumes it is a fresh/new user profile and calls `seedDefaultPaymentMethodsAndRules`. This prevents users from ever clearing or having `0` customized payment methods.

### Resolution
1. Created a `user_preferences` table to track if a user has already had their defaults seeded (`defaults_seeded INTEGER`).
2. Updated `getPaymentMethods(userId)` to check `user_preferences` table. If the user has already been seeded (`defaults_seeded = 1`), do not auto-seed, allowing the list of payment methods to remain empty.

### Verification Test
* **Test Case**: `backend/tests/llm-accuracy.test.ts`
  - *does not re-seed default payment methods and mapping rules once deleted by the user [BUG-009]*

---

## [BUG-010] Test Database Pollution Resetting User Preferences

### Description
Running the backend Jest integration test suite (specifically `gmail.test.ts`) clears tables (including `user_preferences` and `payment_methods`) from the active development database file `daily_expense.db` instead of an isolated test environment. This wipes the user seeding flags, causing the development app to auto-re-seed deleted payment methods and rules on the next query.

### Root Cause
`tests/gmail.test.ts` instantiates `SQLiteTransactionRepository` without any arguments, which defaults to the active development database file specified by `process.env.DATABASE_URL` (or `./data/daily_expense.db` inside `/backend`). The test suite does not redirect `process.env.DATABASE_URL` to a temporary test file.

### Resolution
Updated `tests/gmail.test.ts` to redirect `process.env.DATABASE_URL` to a temporary test database file (`test_gmail.db`) during test setup, and restore it on teardown. This ensures all database writes, schema initializations, and clears are isolated from the development database.

### Verification Test
* **Test Case**: `backend/tests/gmail.test.ts`
  - *All Gmail API integration tests run against isolated test_gmail.db database*

---

## [BUG-011] Stale LLM Logs Prevents Re-Extraction Updates After Reverting to Bronze

### Description
When a user reverts a Silver staging transaction back to Bronze raw input and extracts it again, the LLM extraction log in `llm_extraction_logs` is not updated. This leaves the old/stale LLM log values visible in the read-only preview card in the Silver detail modal.

### Root Cause
In `revertSilverToBronze(userId, silverId)` in `sqlite-transaction-repository.ts`, the database deletes records from `gold_transactions` and `silver_extracted_transactions`, and updates `bronze_raw_inputs.status` back to `'unprocessed'`. However, it does not delete the corresponding log from `llm_extraction_logs`. When the user triggers extraction again, the repository executes `INSERT OR IGNORE INTO llm_extraction_logs`, which ignores the write due to a UNIQUE constraint conflict on `bronze_input_id`.

### Resolution
Updated `revertSilverToBronze` in `sqlite-transaction-repository.ts` to run `DELETE FROM llm_extraction_logs WHERE bronze_input_id = ? AND user_id = ?` using the referenced `silver.bronzeInputId` value, ensuring a clean state for subsequent extractions.

### Verification Test
* **Test Case**: `backend/tests/llm-accuracy.test.ts`
  - *clears LLM log entry upon reverting Silver transaction to Bronze to allow fresh re-extraction [BUG-011]*







