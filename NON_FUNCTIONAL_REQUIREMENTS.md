# Non-Functional Requirements

## Security [NFR-SEC]
- [NFR-SEC-1] Identity Management: The system must use a trusted centralized identity provider for all user authentication in all environments, without bypass options.
- [NFR-SEC-2] API Protection: All non-public API endpoints must require a cryptographically verified security token.
- [NFR-SEC-3] Token Validation: Security tokens must be validated against an official public key set (JWKS) on every inbound request.
- [NFR-SEC-4] Input Validation: The system must validate all user-provided filters for external API integrations to prevent malformed queries and ensure mandatory criteria are met.
- [NFR-SEC-5] Data Segregation Enforcement: The database schemas and API logic must enforce strict data boundaries between users, validating that the authenticated user context matching the request payload matches the database records being modified or read, preventing cross-tenant access.

## Performance & Reliability [NFR-PERF]
- [NFR-PERF-1] Availability Monitoring: The system must provide a health validation service that responds within 100ms.
- [NFR-PERF-2] Dynamic Layout: The system must utilize a responsive design engine to ensure usability across diverse hardware resolutions.
- [NFR-PERF-3] Data Processing: The backend service must handle pagination efficiently to retrieve all requested records without causing memory exhaustion.
- [NFR-PERF-4] Batch Approval Efficiency: The batch approval operation must complete within 200ms per transaction at the API layer, updating the local UI state atomically.

## Availability [NFR-AVAIL]
- [NFR-AVAIL-1] The system should target 99.9% availability for the core platform and third-party integration pipelines.

## Gmail Integration Constraints [NFR-GMAIL]
- [NFR-GMAIL-1] Session Security: Third-party authentication tokens must be handled ephemerally and never persisted to non-volatile storage.
- [NFR-GMAIL-2] Classification Performance: The email categorization must run locally on the server in O(N) complexity using a predefined set of case-insensitive transactional keywords to avoid external service calls.
- [NFR-GMAIL-3] Payment Classification Robustness: The LLM extraction service must parse and classify transaction payment methods with structured precision, defaulting to "Unknown" when payment details are absent from the source content.
- [NFR-GMAIL-4] Progress Feedback Responsiveness: The progress status in the UI must update within 150ms of each email detail ingestion completing, ensuring the user gets real-time awareness of the pipeline status.
- [NFR-GMAIL-5] Extraction Progress Feedback Responsiveness: The progress status in the UI must update within 150ms of each email detail extraction completing, ensuring the user gets real-time awareness of the pipeline status.
- [NFR-GMAIL-6] Category Extraction Robustness: The LLM extraction service must analyze the email body content to classify the transaction into a specific category, mapping to standard expense domains such as Restaurant, Medical, Online Food Order, Transport, Shopping, or Utilities, and fallback to "Other" when context is insufficient.

## Database & LLM Architecture Constraints [NFR-ARCH]
- [NFR-DB-1] Database Portability & Zero-Recode Migration: The storage layer must allow transitioning from a lightweight local environment to a cloud production platform (such as AWS RDS) without requiring modifications to the core business logic code.
- [NFR-DB-2] Relational Data Coherence: The system must maintain relational integrity and enforce transaction constraints to prevent orphaned data records and duplicate entries.
- [NFR-LLM-1] Swap-Ready LLM Ingress: The application must support running a local model on the user's machine during development and switching to cloud-hosted intelligence APIs via configurations without code modifications.
- [NFR-ARCH-2] Medallion Separation: The database architecture must strictly isolate Bronze, Silver, and Gold structures, ensuring clean transition actions on user verification.

## Usability [NFR-USAB]
- [NFR-USAB-1] Ingestion Status Feedback: The UI must clearly indicate the processing status of each raw email within 100ms of loading the Raw Emails list to prevent cognitive load and redundant user attempts.
- [NFR-USAB-2] Ingestion Status Filtering Usability: The status filter controls in the Bronze section must update the view instantly (within 50ms) to allow efficient navigation between processed and unprocessed emails.
- [NFR-USAB-3] Typography and Readability: The UI must utilize a highly readable, modern font scale (minimum 12px for body copy, avoiding tiny 8px text) and clear contrast hierarchy to prevent eye strain and improve readability.
- [NFR-USAB-4] Design Consistency and Visual Hierarchy: The layout must use modern, cohesive component styling (glassmorphism/subtle shadows, HSL custom palette, card layouts, and micro-interactions) to establish a premium and professional user interface. Tables and list layouts must be structured to prevent horizontal scrolling or clipping by keeping rows clear of inline action buttons and columns, reserving the full layout width for transaction metadata, and centralizing details/deletion triggers on the primary text identifiers (Subject/Merchant).
- [NFR-USAB-5] Layout Contextual Adaptability: The UI layout must adapt contextually based on the active tab, hiding irrelevant configuration panels and maximizing display area for tables (e.g. extending Silver and Gold tables to full width) when configuration is not needed.
- [NFR-USAB-6] Data Lineage Traceability & Visibility: The lineage visualization must clearly present the data states across all three layers (raw, staging, and ledger) to allow the user to easily track the origin and downstream confirmation status of any expense item.
- [NFR-USAB-7] Soft-Delete and Data Integrity: Reverting and deleting records must never cause database referential integrity failures. Active Bronze records (raw inputs) and direct manual Gold transactions can be soft-deleted. Reverting a Silver transaction or email-source Gold transaction must safely hard-delete those records without leaving orphaned records or breaking constraints. The Trash Bin must display deleted Bronze raw inputs and soft-deleted manual Gold transactions, and allow restoring them to their active states.
- [NFR-USAB-8] Date Range Filtering Responsiveness: Changing the date range filters on any tab must automatically refresh the respective data lists from the database within 150ms, ensuring consistent and real-time data views across all pipeline stages.
- [NFR-USAB-9] Validation Feedback Responsiveness: When a user corrects staging transaction errors, the visual indicator highlighting the row as an error must update instantly (within 100ms) upon saving the updates, and the option to approve must be enabled immediately.
- [NFR-USAB-10] Payment Standardization Usability: Standardized payment method dropdowns and inline management must respond to modifications immediately (within 100ms), and auto-mapping rules must standardize payment names instantly during LLM extraction and manual entries.
- [NFR-USAB-11] Client-side Filtering Performance: Searching, filtering, and sorting operations on the Gold Transactions page must refresh the displayed list instantly (within 100ms) to ensure smooth interface responsiveness.
- [NFR-USAB-12] Consistent Premium Styling: The user interface components on the Gold Transactions page must adhere strictly to the Outfit font typography, custom HSL palette, and glassmorphic designs of the core application layout.
- [NFR-USAB-13] Rejection Action Responsiveness: When a user rejects a staging transaction, the status badge in the details modal and the staging list table must update instantly (within 100ms) without requiring page reload.
- [NFR-USAB-14] Bronze Rejection Action Responsiveness: When a user rejects or restores a Bronze raw input, the status badge in the details modal and the raw inputs list table must update instantly (within 100ms) without requiring page reload.
- [NFR-USAB-15] Bronze Batch Rejection Responsiveness: When a user batch-rejects multiple raw inputs, the status badges in the list table and count indicators must update instantly (within 150ms) without requiring page reload.
- [NFR-USAB-16] Refund Balancing and Layout Consistency: Displaying refunds as negative credit values and updating cumulative net expense metrics on the dashboard and ledger tables must respond within 150ms of any update, keeping the typography standard ('Outfit') and glassmorphic aesthetics unified.
- [NFR-LLM-2] Accuracy Aggregate Query Performance: The database query computing percentage match statistics across the ledger and LLM logs must execute within 100ms.
- [NFR-USAB-17] Accuracy Metrics Visual Consistency: The dashboard parser performance card must adhere strictly to the custom 'Outfit' typography and glassmorphic styling of the core layout.
- [NFR-USAB-18] Lineage Comparison Load Latency: Resolving and displaying the side-by-side comparison table in the detail modal must load within 150ms of expanding the lineage section.
- [NFR-USAB-19] Staging Original Preview Load Latency: When reviewing a pending transaction in the Silver staging queue, the original LLM extracted details preview card must load and render within 150ms of opening the modal, utilizing standard 'Outfit' typography and card layout elements.
- [NFR-USAB-20] Payment Standardization Priority Latency: The priority evaluation and ranking of all payment mapping rules must resolve in less than 50ms during raw string matching to avoid any noticeable delay during transaction processing.
- [NFR-USAB-21] Category Selection Interface: The user interface must present a standardized dropdown select control for category assignments across all transaction edit and creation forms, ensuring users select from unique predefined options while dynamically supporting legacy custom category values.
- [NFR-USAB-22] Ledger Filters Usability & Performance: Applying, toggling, or resetting the Category, Payment Method, and Source filters on the Gold Ledger page must update the transaction table view and recalculate aggregates instantly (within 100ms) to ensure interactive responsiveness.
- [NFR-USAB-23] Currency Validation & Correction Latency: Modifying, validating, or updating the currency field inside the detail modals must update the transaction state, reflect errors immediately in the modal, and save changes within 100ms.
- [NFR-USAB-24] Consistent Filtering & Table Layout Design: The search inputs, sorting options, and MultiSelect filter dropdowns across Silver staging, Gold pipeline, and Gold Ledger page tables must maintain uniform layout styling, HSL tailwind colors, Outfit typography, and update the list data dynamically within 100ms. All tables must cleanly isolate the currency code into its own column, keeping the Amount column strictly numerical.
- [NFR-USAB-25] Local Timezone Formatting Latency: The UI must format UTC database timestamps (such as received_at) to the browser's local timezone (including both date and time components) within 100ms of the component loading, ensuring immediate locale-specific readability.
- [NFR-USAB-26] Persistent Fetcher Suggestions Performance: Retrieving the list of saved sender emails from the database and rendering them as autocomplete suggestions inside the fetcher configuration panel must complete within 100ms, and saving a new sender email address to the database must execute within 150ms to ensure a lag-free input experience.


