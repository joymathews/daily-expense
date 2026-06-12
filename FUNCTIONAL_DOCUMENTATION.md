# Functional Documentation

## Application Platform [FUNC-CORE]

### User Interface [FUNC-UI]
- [FUNC-SKEL-UI-1] The user must be able to access the application dashboard through a secure web browser session.
- [FUNC-SKEL-UI-2] The user must see a personalized greeting and "DAILY EXPENSE" branding on the dashboard to confirm operational status.
- [FUNC-SKEL-UI-3] The user must experience a high-density responsive interface optimized for desktop, tablet, and mobile screens.

### System Operations [FUNC-SYS]
- [FUNC-SKEL-SYS-1] An external monitoring system must be able to verify the health of the application services to ensure maximum uptime.

## User Authentication [FUNC-AUTH]
- [FUNC-AUTH-1] The user must be challenged for credentials (username/email and password) before being allowed to access protected system areas.
- [FUNC-AUTH-2] The system must remain inaccessible to unauthenticated users, enforcing a redirection to a secure login interface.
- [FUNC-AUTH-3] Authenticated users must have the ability to securely terminate their session (Log Out).
- [FUNC-AUTH-4] The system must isolate transaction data (raw emails/Bronze, staging transactions/Silver, and confirmed ledger/Gold) by user. A logged-in user must only be able to view, save, modify, and delete their own transaction records. Other users' records must not be visible or modifiable under any circumstances.

## Gmail Integration [FUNC-GMAIL]
- [FUNC-GMAIL-1] Navigation: The user must be able to navigate to the Gmail Fetcher service through the primary navigation menu.
- [FUNC-GMAIL-2] Configuration: The user must be able to define granular filters to target specific expenses. At least one Sender Email and a Date Range (start and end date) are mandatory. The Subject filter is optional.
- [FUNC-GMAIL-3] Authentication: The user must be prompted to authorize the system to access their Google account via a secure OAuth2 popup.
- [FUNC-GMAIL-4] Display: The system must display fetched transaction data in a high-density table showing Date, Sender, and Transaction Details. For the staging queue (Silver layer), Date must be the first data column (followed by Merchant and Amount as separate columns), Category and Payment Method must be vertically stacked, and Status and Action must be vertically stacked to optimize horizontal screen space.
- [FUNC-GMAIL-5] Pagination: The system must retrieve all matching emails for the specified filters by automatically paginating through the Gmail API results.
- [FUNC-GMAIL-6] Email Segregation: The system must automatically analyze fetched emails and categorize them into two lists: "with transaction" and "without transaction" based on transactional keywords in the subject or body snippet.
- [FUNC-GMAIL-7] Separate Presentation: The system must display the two lists of emails (transactional and non-transactional) in separate sections or tabs to the user.
- [FUNC-GMAIL-8] Manual Review: The system must provide options for the user to manually review and move emails between the "with transaction" and "without transaction" sections.
- [FUNC-GMAIL-9] Email Detail View: The user must be able to click on any fetched email to view its details (subject, sender, date, and full decoded plain-text body content) in a secure modal popup.
- [FUNC-GMAIL-10] Modal Action Override: Inside the detail modal view, the user must have the option to mark the email as transactional or non-transactional, which updates the local email state and count badge immediately.
- [FUNC-GMAIL-11] Local Email Logging & Audit Trail: The system must automatically store a complete local copy of the fetched email history so that the application has a reliable, queryable log of raw messages for auditing and re-processing.
- [FUNC-GMAIL-12] Staging Review Queue: The system must automatically scan raw emails and extract transaction-related fields (such as merchant, amount, currency, and date) into a staging review queue so the user can verify them before they affect reports.
- [FUNC-GMAIL-13] Review and Final Ledger Approval: The user must be able to edit, correct, and approve transactions from the staging review queue, confirming their accuracy before they are finalized as core expense records.
- [FUNC-GMAIL-14] Automatic Duplicate Ingestion Prevention: The system must detect and skip previously processed emails during successive fetches, ensuring the user is never prompted to review or log the same transaction multiple times.
- [FUNC-GMAIL-15] Separate Data View Options: The user must be able to view separate lists of their data matching the Medallion layers: Raw Emails (Bronze), Extracted Staging (Silver), and Confirmed Ledger (Gold).
- [FUNC-GMAIL-16] Date Range Filtering: The user must be able to filter the listed records in Bronze, Silver, and Gold tables by a selected date range.
- [FUNC-GMAIL-17] On-Demand Ingestion & Batch Extraction: The user must be able to trigger the Ollama extraction logic manually for a single raw email or in batches for multiple selected raw emails.
- [FUNC-GMAIL-18] Confirmed Ledger Corrections: The user must be able to edit and save corrections directly to confirmed transaction records in the Gold table.
- [FUNC-GMAIL-19] Raw Email Deduplication: The system must verify that duplicate raw email imports are ignored at the database level using Gmail Message ID as a unique natural primary key.
- [FUNC-GMAIL-20] Data Lineage Tracing: The system must display lineage linkages between Bronze, Silver, and Gold records, allowing the user to view original email content from staging or ledger items.
- [FUNC-GMAIL-21] Processed Emails Visibility: The system must display a distinct visual status or indicator (such as a 'Processed' badge) for already extracted or approved emails in the Raw Emails (Bronze) list, and disable or update the action button for those emails to prevent duplicate extraction actions.
- [FUNC-GMAIL-22] Silver Batch Approval: The user must be able to select multiple staging transactions in the Silver queue and approve them in a single batch operation, promoting them directly to the Gold ledger.
- [FUNC-GMAIL-23] Bronze Ingestion Status Filter: The user must be able to filter the Raw Emails (Bronze) list based on their processing status (e.g., show "All", "Processed only", or "Unprocessed only").
- [FUNC-GMAIL-24] Payment Method Extraction: The user must be able to see how a transaction was made (such as UPI, credit card, bank transaction) automatically extracted from raw emails and displayed in the staging review queue (Silver layer).
- [FUNC-GMAIL-25] Staging Payment Review & Editing: The user must be able to view, edit, and correct the extracted payment method in the staging queue (Silver layer) before promoting it to the final ledger.
- [FUNC-GMAIL-26] Verified Ledger Method Display & Correction: The user must be able to view the payment method in the ledger tables and edit or correct the payment method of approved transaction ledger records in the Gold table.
- [FUNC-GMAIL-27] Ingestion Progress Tracking: The user must be informed immediately when the email fetching process has started, see real-time progress updates (e.g., current email count being fetched), and receive a clear confirmation message upon completion.
- [FUNC-GMAIL-28] Extraction Progress Tracking: The user must be informed immediately when the email extraction process (on-demand for a single email or in batch) starts, see real-time progress updates (showing current email index, total count, and current email subject being processed), and receive a clear confirmation message upon completion of extraction.


