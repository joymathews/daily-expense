# Project Instructions

## 1. Project Overview
"Daily Expense" is a full-stack web application designed to help users track their daily spending. It focuses on a clean, responsive UI and a robust, tested backend.

## 2. Mandatory Development Workflow
For ALL future changes, feature implementations, and code modifications, you must strictly adhere to this sequential workflow:

1. **Plan Mode First:** Formulate a comprehensive implementation plan in Plan Mode before making any modifications. This plan must:
   - Extract requirements from the user's prompt.
   - Design the solution in alignment with the [Architectural and Design Policies](#7-architectural-and-design-policies-solid--clean-code-reference) in Section 7.
   - Account for existing functional `FUNCTIONAL_DOCUMENTATION.md` and non-functional requirements `NON_FUNCTIONAL_REQUIREMENTS.md`, as well as current bugs/defects `BUG_REGISTRY.md`.
   - Outline how the solution will be tested, including validation strategies for edge-case scenarios.
2. **Functional Requirements:** Explicitly define functional requirements and update `FUNCTIONAL_DOCUMENTATION.md` FIRST. All functional requirements MUST be written in a **user-centric** style — describing what the user can do or experience, not what the system does internally. Use language such as *"The user must be able to..."*, *"When the user does X, the system must Y"*, or *"The user must see/receive/be notified of..."*. Requirements written from a purely technical, system-centric perspective are not acceptable.
3. **Non-Functional Requirements:** Update `NON_FUNCTIONAL_REQUIREMENTS.md` with system qualities (Security, Performance, Availability, Scalability, Usability, etc.).
4. **Tech Stack & Standards:** Document all technical stack choices, library additions, and engineering standards in Section 3 of this `GEMINI.md` file. NEVER add these to requirement documents.
5. **Requirements Hygiene:** NEVER include technical noise, shell command outputs, or implementation logs in documentation.
6. **Defect Resolution Workflow (Bug Fixing):** When fixing a reported bug or edge-case defect, you MUST log the issue in `BUG_REGISTRY.md` with a unique ID `[BUG-XXXX]`, write regression tests mapping to this ID, and record the resolution details in the registry.
7. **Test-Driven Development (TDD):** Update or create test cases based *only* on the newly updated documentation/defect log. Every test MUST use the Test Justification Framework mapping to a `[FUNC-*]`, `[NFR-*]`, or `[BUG-*]` ID.
8. **Implementation:** Write or modify code specifically to make the new and existing tests pass, ensuring that all code strictly adheres to the [Clean Code Execution Rules](#2-clean-code-execution-rules) in Section 7.
9. **Post-Change Verification:** Explicitly run the relevant test suites (Unit or Integration) and verify that all tests pass.

## 3. Tech Stack & Engineering Standards
* **Backend:** Node.js (TypeScript), Express, Jest. Identity: AWS Cognito. JWT Validation: `express-jwt` + `jwks-rsa`. External APIs: `googleapis` (for Gmail). Database: `sqlite3` and Azure SQL Database (`mssql` driver with connection pooling, selected dynamically via `DB_PROVIDER` environment variable and Repository Factory pattern). LLM Integration: Ollama (localhost API interface). Environment Configuration: `dotenv`.
* **Frontend:** React (TypeScript), Vite, Tailwind CSS, Vitest. Auth: AWS Amplify (for Cognito), `@react-oauth/google` (for Gmail). Navigation: `react-router-dom` (routes: `/` for Dashboard, `/ingestion` for Data Ingestion, `/pipeline` for Transaction Pipeline, `/transactions` for Gold Ledger Transactions, and `/analytics` for Financial Analytics).
* **Shared Financial Core:** Pure TypeScript workspace library (`packages/financial-core`, `@daily-expense/financial-core`) housing all financial forecasting, cycle date boundaries, daily allowance calculations, spend filtering, and pattern detectors. Shared across desktop and mobile without React/DOM coupling.
* **Mobile PWA:** Progressive Web App (`mobile-pwa`), Vite + React + Tailwind CSS + `vite-plugin-pwa` + AWS Amplify + `@daily-expense/financial-core`. Optimized exclusively for mobile form factors (portrait prioritized, landscape adaptable). Includes Gatekeeper cloud wake-up probe for ACA/Azure SQL auto-pause cold starts. Default Dev Port: `5174`.
* **Logging System:** Unified logger persisting to a consolidated file (`logs/app.log`). Backend utilizes `pino` for low-overhead asynchronous logging and `pino-http` for Express request details. Frontend uses `loglevel` with network log forwarding disabled statically via `VITE_ENABLE_LOG_FORWARDING` (or dynamically via `localStorage` override) to minimize network overhead. The logs are viewed and formatted locally using open-source parsers like `pino-pretty` and `Logdy`.
* **Architecture:** Strictly adhere to SOLID principles and Clean Code rules.
* **Testing:** Backend tests in `backend/tests`, frontend tests in `frontend/src/*.test.tsx`.
* **CLI Utilities:** Standalone Node.js scripts inside the `tools/` folder, configured via root `package.json` scripts, to perform database administrative and maintenance operations directly.
* **Style:** Tailwind utility classes are the primary styling method; avoid Vanilla CSS.

* **Typography & Fonts:** The application standard is Google Font 'Outfit' to provide clean, high-readability UI typography, loaded dynamically through the `index.html` head section.

* **User Isolation Standard**: Every endpoint under `/api/ingestion` and `/api/pipeline` must use `checkJwt` to authenticate users. The database tables (Bronze, Silver, and Gold layers) must strictly isolate records by `user_id` parsed from `req.auth.sub`. In the frontend, the Cognito JWT token retrieved via `fetchAuthSession` must be attached to the `Authorization` header of all API calls.

* **Financial Core Domain Isolation Standard**: ALL financial calculations, metric aggregations, spend reductions, currency summaries, budget forecasts, run-rate velocity metrics, daily allowance formulas, billing cycle boundaries, recurring bill patterns, and savings logic MUST strictly reside in the shared `@daily-expense/financial-core` (`packages/financial-core`) workspace library. UI layers (`frontend` desktop and `mobile-pwa`) are strictly presentation layers and MUST NEVER write inline financial math or duplicate domain calculations. Any change affecting financial calculations must be implemented and unit-tested in `packages/financial-core` first.

* **Dependency Security Standard**: Zero Critical and High vulnerabilities permitted across backend and frontend dependencies. Routine `npm audit` checks must be performed to maintain package health.

* **Active-Cycle & Date-Bounded Query Standard**: All UI components, overview panels, charts, tables, and analytics modules MUST query backend transaction endpoints with explicit date boundaries (`startDate` and `endDate`) matching the active billing cycle or the active viewing window. Unbounded queries across all-time historical data (`GET /api/pipeline/gold-transactions` without date parameters) are strictly prohibited on initial page renders. Any historical cycle comparison or multi-month calendar navigation MUST use on-demand lazy querying with local in-memory caching to guarantee constant O(1) initial render speeds regardless of total lifetime records in the database.



## 4. Coding & Naming Conventions
* **Files:** Use `kebab-case` for all file names.
* **Variables/Functions:** Use `camelCase`.
* **Components:** Use `PascalCase` for React components.
* **Types/Interfaces:** Use `PascalCase`.

## 5. Environment Management
* Never commit `.env` files. Use `.env.example` as a template.
* Default Ports: Backend `3001`, Frontend `5173`.

## 6. Running the Application & Tests
* **Backend:** `npm run dev` / `npm test` (inside `/backend`)
* **Frontend:** `npm run dev` / `npm test` (inside `/frontend`)

### Requirement Traceability Matrix (RTM)
* **Generate RTM Report:** `npm run rtm` (Generates `rtm_report.html` in the root)

## 7. Architectural and Design Policies (SOLID & Clean Code Reference)

You must design and implement all solutions using the **SOLID Design Principles** as the primary architectural reference, backed by strict **Clean Code** rules. Every code modification, new component, or refactoring plan must be validated against these criteria to enforce high cohesion, loose coupling, and maximum readability.

### 1. Core SOLID Implementation Policies

* **S - Single Responsibility Principle (SRP):**
    * *Rule:* A class, module, or function must have one, and only one, reason to change.
    * *Application:* Separate business logic entirely from UI rendering, data access, and transport layers. If a component handles both data fetching and data presentation, split it into a hook/service and a pure presentation component.
* **O - Open/Closed Principle (OCP):**
    * *Rule:* Software entities must be open for extension, but closed for modification.
    * *Application:* Avoid modifying existing core logic or adding massive `if/else` / `switch` chains when adding new features. Instead, use polymorphism, strategy patterns, or configuration objects to extend behavior.
* **L - Liskov Substitution Principle (LSP):**
    * *Rule:* Subtypes or interface implementations must be completely substitutable for their base types without breaking the application.
    * *Application:* Do not implement interface methods that throw "Not Implemented" errors or silently fail. Every derived class must honor the exact contract of the parent.
* **I - Interface Segregation Principle (ISP):**
    * *Rule:* Clients must not be forced to depend on methods or properties they do not use.
    * *Application:* Favor small, lean, role-specific interfaces over bloated, multi-purpose contracts. Split large interfaces into distinct, specialized definitions.
* **D - Dependency Inversion Principle (DIP):**
    * *Rule:* High-level modules must not depend on low-level details; both must depend on abstractions.
    * *Application:* Never hardcode direct instantiations (`new ConcreteClass()`) inside core business logic. Use Dependency Injection (DI) to pass required services, databases, or clients as abstractions/interfaces.

### 2. Clean Code Execution Rules

When writing or refactoring code, enforce the following standards for readability and maintainability:

* **Meaningful Names:** Use intention-revealing, pronounceable, and searchable names for variables, functions, and classes. Avoid arbitrary abbreviations (e.g., use `userRegistrationTimeoutInMs` instead of `urt`).
* **Small, Focused Functions:** Functions must be small, ideally fewer than 20 lines, and do exactly **one thing**. 
* **Descriptive Function Names:** Prefer a long, descriptive function name over a short, ambiguous one combined with a comment (e.g., `calculateMonthlySubscriptionFee()` instead of `calcFee()`).
* **Minimize Arguments:** Functions should ideally have zero to two arguments. If a function requires three or more arguments, encapsulate them into a single configuration object/type.
* **No Side Effects:** A function must not secretly modify global state, alter passed arguments by reference unexpectedly, or make hidden system changes.
* **Don't Repeat Yourself (DRY):** Eliminate duplication. Abstract repetitive logic, structures, or algorithms into reusable functions or utility modules.
* **Self-Documenting Code over Comments:** Write code that reads like well-written prose. Only use comments to explain the *why* behind a non-obvious business decision or a complex workaround, never to explain *what* a poorly named variable or function is doing.
* **Scout Rule:** Always leave the code cleaner than you found it. If you modify a file, take a moment to fix minor clean-code violations within that scope.
* **User-Centric Naming:** Functions, UI labels, API actions, and event handlers must be named from the **user's perspective** — describing what the user does or achieves, not internal system mechanics. Examples: prefer `rejectTransaction()` over `setStatusRejected()`, prefer `approveStagingEntry()` over `promoteToGoldLayer()`, prefer button label *"Mark as Non-Transactional"* over *"Update hasTransaction Flag"*. If a function name makes sense only to a developer and not to the user whose action triggers it, rename it.

### 3. Architectural Metrics for Success
* **High Cohesion:** Code that changes together must live together. Functions and classes must be highly focused on their singular domain task.
* **Loose Coupling:** Components must be isolated. Changing a database schema, an external API client, or a UI style framework must not trigger a cascade of breaking modifications in the core business logic layers.
