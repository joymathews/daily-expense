# Non-Functional Requirements

## Security [NFR-SEC]
- [NFR-SEC-1] Identity Management: The system must use a trusted centralized identity provider for all user authentication.
- [NFR-SEC-2] API Protection: All non-public API endpoints must require a cryptographically verified security token.
- [NFR-SEC-3] Token Validation: Security tokens must be validated against an official public key set (JWKS) on every inbound request.
- [NFR-SEC-4] Input Validation: The system must validate all user-provided filters for external API integrations to prevent malformed queries and ensure mandatory criteria are met.

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

## Database & LLM Architecture Constraints [NFR-ARCH]
- [NFR-DB-1] Database Portability & Zero-Recode Migration: The storage layer must allow transitioning from a lightweight local environment to a cloud production platform (such as AWS RDS) without requiring modifications to the core business logic code.
- [NFR-DB-2] Relational Data Coherence: The system must maintain relational integrity and enforce transaction constraints to prevent orphaned data records and duplicate entries.
- [NFR-LLM-1] Swap-Ready LLM Ingress: The application must support running a local model on the user's machine during development and switching to cloud-hosted intelligence APIs via configurations without code modifications.
- [NFR-ARCH-2] Medallion Separation: The database architecture must strictly isolate Bronze, Silver, and Gold structures, ensuring clean transition actions on user verification.

## Usability [NFR-USAB]
- [NFR-USAB-1] Ingestion Status Feedback: The UI must clearly indicate the processing status of each raw email within 100ms of loading the Raw Emails list to prevent cognitive load and redundant user attempts.
