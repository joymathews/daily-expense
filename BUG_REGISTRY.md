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

---

## [BUG-012] Payment Mapping Priority Conflict

### Description
When standardizing a payment method, the repository evaluates rules sequentially. A generic mapping rule checked first will intercept raw input that matches a more specific rule checked later (e.g. raw output `"hdfc rupay credit card"` matches generic `"hdfc"` or `"hdfc + credit + card"` and gets mapped, overriding `"hdfc + rupay"`).

### Root Cause
In `standardizePaymentMethod`, mapping rules are evaluated in a simple `for` loop as they are fetched from the database, and the first matching rule is immediately returned. There is no ranking or specificity check to ensure the most specific rule takes precedence.

### Resolution
Updated `standardizePaymentMethod` to run the matching logic over all user payment mapping rules in a single loop, tracking the matching rule that has the maximum number of matched parts (`parts.length`). If there is a tie in the number of parts, the rule with the longer pattern length is preferred.

### Verification Test
* **Test Case**: `backend/tests/gmail.test.ts`
  - *should prioritize more specific payment mapping rules based on number of parts and length [BUG-012]*

---

## [BUG-013] Daily Spend Timeline Chart Date Range & X-Axis Alignment

### Description
The daily trend timeline chart SVG displays X-axis ticks/labels that are misaligned with actual dates when the transaction points are sparse, or it lacks proper chronological continuity when days have no spend. Also, the test environment fails due to a ReferenceError for `svg`.

### Root Cause
1. The chart rendering only mapped dates that had transaction records, which made step coordinates space unevenly compared to real-time distance and made date ranges like start/middle/end misalign.
2. The test file `Analysis.test.tsx` used `svg` without declaring or querying it in the test scope.

### Resolution
1. Re-engineered `Analysis.tsx` to generate continuous daily points spanning from the start date to the end date, mapping empty spend days to 0.
2. Cleaned up X-axis tick and label coordinates to align with actual step calculations.
3. Updated `Analysis.test.tsx` to query the SVG element correctly using `container.querySelector('svg')` before asserting its attributes.

### Verification Test
* **Test Case**: `frontend/src/pages/Analysis.test.tsx`
  - *renders SVG daily spend chart and text details [BUG-013]*

---

## [BUG-014] Active Cycle Date Formatting Timezone Shift

### Description
On the Analysis page, configuring a billing cycle start day of `17` displays the active cycle range starting from the `16th` (e.g. `2026-06-16 TO 2026-07-16` instead of `2026-06-17 TO 2026-07-17`).

### Root Cause
The `getActiveCycleRange` helper uses `new Date(year, month, day)` to construct local Date instances, but uses `.toISOString().split('T')[0]` to format them. In timezones ahead of UTC (such as `+05:30`), converting the local midnight date `00:00:00` to UTC shifts the date backward by one day (e.g., `2026-06-16T18:30:00Z`).

### Resolution
Replaced `.toISOString()` usage in date formatting with a timezone-safe local date formatter that constructs `YYYY-MM-DD` using local getters: `d.getFullYear()`, `d.getMonth() + 1`, and `d.getDate()`.

### Verification Test
* **Test Case**: `frontend/src/pages/Analysis.test.tsx`
  - *correctly calculates and visualizes allocation buckets* (verifies correct billing cycle dates calculation).

---

## [BUG-015] Daily Spend Date Filter Syncing with Billing Cycle Preference

### Description
The date range filters in the Daily Spend Timeline are synchronized with the billing cycle preferences. Whenever a user updates their billing cycle start day preference, the trend date filters are reset and overwritten, preventing them from being independent.

### Root Cause
1. A `useEffect` hook in `Analysis.tsx` tracked `billingCycleStartDay` and updated `filterStartDate` and `filterEndDate` to the newly calculated billing cycle range.
2. The initial states and the "Reset" button defaulted to the active cycle range rather than a cycle-independent default date range.

### Resolution
1. Removed the `useEffect` hook that synchronizes daily trend filters on `billingCycleStartDay` changes.
2. Initialized `filterStartDate` and `filterEndDate` to the current calendar month (1st of the month to the last day of the month) which is independent of billing cycle configurations.
3. Updated the "Reset" button to restore the trend filters to the current calendar month range.

### Verification Test
* **Test Case**: `frontend/src/pages/Analysis.test.tsx`
  - *maintains independent daily trend filters when cycle preferences change [BUG-015]*

---

## [BUG-016] Fixed Charge Template Payment Method Hardcoded to 'Fixed' and Omitted from Form

### Description
The recurring fixed charges templates configuration interface does not allow users to specify a payment method when creating or editing a template. In addition, all upfront generated and synchronized transactions for a fixed charge are stored with a hardcoded payment method of `'Fixed'`, which does not reflect actual payment modes (e.g. UPI, Credit Card, Cash, etc.) used by the user.

### Root Cause
The frontend configuration form in `DataIngestion.tsx` lacks a selector/input for the payment method. The backend `fixed_charges` SQLite database table is missing a `payment_method` column, and the repository methods `saveFixedCharge` hardcode `'Fixed'` in the `INSERT` and `UPDATE` statements for `gold_transactions`.

### Resolution
1. Added a nullable `payment_method` column to the `fixed_charges` table schema and run an inline SQLite table migration (`ALTER TABLE`) if missing.
2. Updated the backend interface `FixedCharge` and frontend interface `FixedChargeTemplate` to include a `paymentMethod` property.
3. Modified the repository CRUD methods (`getFixedCharges`, `saveFixedCharge`) to persist, query, and utilize the customized `paymentMethod` when creating or modifying templates and their corresponding gold transactions.
4. Implemented a Select dropdown list in the settings fixed charges configuration form in `DataIngestion.tsx` to let the user choose from standard/custom payment methods, and update state synchronization inside `handleEditFc` and submission handlers.

### Verification Test
* **Test Case**: `backend/tests/fixed-charges.test.ts`
  - *should support saving fixed charges templates with a custom payment method and propagating it to gold ledger occurrences [BUG-016]*
* **Test Case**: `frontend/src/App.test.tsx`
  - *provides navigation to the settings tab on Ingestion page and displays widgets on Ledger page* (asserts dropdown value selection and template rendering).

---

## [BUG-017] Dashboard Weekly Expense Trend Visualizer Displays Simulated / Empty Data

### Description
The weekly expense trend visualizer rendered on the Dashboard page does not present real financial metrics from the ledger. Instead, it displays hardcoded simulated percentages of the overall gold total amount, and returns an empty/zero-filled state if the user has no transactions in the current calendar week.

### Root Cause
In `Dashboard.tsx`, the `weeklyTrendData` array is a static simulated array calculating predefined percentages (e.g. 15%, 25%) of `metrics.goldTotalAmount`. It does not execute chronological date range grouping or filter by transaction date and type.

### Resolution
Replaced the simulated array logic in `Dashboard.tsx` with dynamic local aggregation:
1. Fetch gold transactions directly from the modern `/api/pipeline/gold-transactions` endpoint.
2. Set the end date of the 7-day visualization range to the current local date (today).
3. Compute the expenditure sums for the 7 calendar days ending on today (adding standard debit/expense transactions, subtracting refunds, and excluding transfers/fixed charges).
4. Render the bars and dynamically display the weekday name alongside the date (e.g. "Sun 21/06") on the labels under the chart.

### Verification Test
* **Test Case**: `frontend/src/App.test.tsx`
  - *displays the weekly trend chart on the dashboard using real transaction data [BUG-017]*

---

## [BUG-018] Custom Categories Missing from Autocomplete Suggestions in Modals and Forms

### Description
When a user adds a new custom category (e.g. by typing it in a transaction or manual entry form), the new category appears in the Category filter dropdown because it dynamically queries the ledger transaction list. However, when the user opens the transaction details/edit modal or fixed charge creation forms, the category autocomplete input datalist suggestions list only displays standard hardcoded categories, and the newly added custom category is missing.

### Root Cause
In `EmailDetailModal.tsx` and `DataIngestion.tsx`, the datalist suggestions options are hardcoded to map over a local/imported static `STANDARD_CATEGORIES` list. The UI components do not merge standard categories with existing unique custom categories from the `goldTransactions` and `silverTransactions` lists.

### Resolution
1. Move `STANDARD_CATEGORIES` to a central location (`frontend/src/utils/transaction-helper.ts`) and export it.
2. In `EmailDetailModal.tsx` and `DataIngestion.tsx`, dynamically combine `STANDARD_CATEGORIES` with the unique categories extracted from the `goldTransactions` and `silverTransactions` props/hooks.
3. De-duplicate categories case-insensitively and sort them alphabetically, using this list to populate the autocomplete datalist options.

### Verification Test
* **Test Case**: `frontend/src/App.test.tsx`
  - *suggests custom categories dynamically in the edit modal and creation forms [BUG-018]*

---

## [BUG-019] Transaction Edit Save Modal Persistence & Closing Behavior

### Description
When editing a transaction inside `EmailDetailModal`:
1. Clicking **"Save Updates"** on a Silver staging transaction updates the database record but does not close the modal, leaving the user with no explicit visual acknowledgment of completion.
2. Clicking **"Save Corrections"** on a Gold transaction calls `updateGoldTransaction`, but `updateGoldTransaction` silently swallows API errors without throwing, causing the modal to close even when the server request fails.
3. Neither save button displays an inline error alert message or a pending loading state (**"Saving..."**) during submission.

### Root Cause
1. `handleUpdateSilver` in `EmailDetailModal.tsx` did not invoke `setSelectedEmail(null)` after completing the update API call.
2. `updateGoldTransaction` and `updateSilverTransaction` in `use-gmail-integration.ts` caught errors internally without checking `response.ok` or re-throwing exceptions, preventing `EmailDetailModal.tsx` from catching API failures.
3. `EmailDetailModal.tsx` lacked `isSaving` and `saveError` state management and error banner rendering.

### Resolution
1. Refactored `updateGoldTransaction` and `updateSilverTransaction` in `use-gmail-integration.ts` to check `response.ok` and throw an `Error` on failure.
2. Added `isSaving` and `saveError` local state to `EmailDetailModal.tsx`.
3. Updated `handleUpdateSilver` to call `setSelectedEmail(null)` upon success, and catch errors to populate `saveError` while leaving the modal open.
4. Updated `handleSave` (Gold mode) to call `setSelectedGoldTransaction(null)` upon success, and catch errors to populate `saveError` while leaving the modal open.
5. Rendered a prominent inline red error alert banner inside the modal body when `saveError` is present, and displayed `"Saving..."` loading state on save buttons.

### Verification Test
* **Test Case**: `frontend/src/App.test.tsx`
  - *automatically closes modal on successful transaction update and presents error banner on failure [BUG-019]*

