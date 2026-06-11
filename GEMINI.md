# Project Instructions

## 1. Project Overview
"Daily Expense" is a full-stack web application designed to help users track their daily spending. It focuses on a clean, responsive UI and a robust, tested backend.

## 2. Mandatory Development Workflow
For ALL future changes, feature implementations, and code modifications, you must strictly adhere to this sequential workflow:

1. **Plan Mode First:** Formulate a comprehensive implementation plan in Plan Mode(As per the architectural and Design Policies (SOLID & Clean Code Reference)) before making any modifications.
2. **Functional Requirements:** Explicitly define functional requirements and update `FUNCTIONAL_DOCUMENTATION.md` FIRST.
3. **Non-Functional Requirements:** Update `NON_FUNCTIONAL_REQUIREMENTS.md` with system qualities (Security, Performance, Availability, Scalability, Usability, etc.).
4. **Tech Stack & Standards:** Document all technical stack choices, library additions, and engineering standards in Section 3 of this `GEMINI.md` file. NEVER add these to requirement documents.
5. **Requirements Hygiene:** NEVER include technical noise, shell command outputs, or implementation logs in documentation.
5. **Test-Driven Development (TDD):** Update or create test cases based *only* on the newly updated documentation. Every test MUST use the Test Justification Framework mapping to a `[FUNC-*]` or `[NFR-*]` ID.
6. **Implementation:** Write or modify code specifically to make the new and existing tests pass.
7. **Post-Change Verification:** Explicitly run the relevant test suites (Unit or Integration) and verify that all tests pass.

## 3. Tech Stack & Engineering Standards
* **Backend:** Node.js (TypeScript), Express, Jest. Identity: AWS Cognito. JWT Validation: `express-jwt` + `jwks-rsa`. External APIs: `googleapis` (for Gmail). Database: `sqlite3`. LLM Integration: Ollama (localhost API interface). Environment Configuration: `dotenv`.
* **Frontend:** React (TypeScript), Vite, Tailwind CSS, Vitest. Auth: AWS Amplify (for Cognito), `@react-oauth/google` (for Gmail). Navigation: `react-router-dom`.
* **Architecture:** Strictly adhere to SOLID principles and Clean Code rules.
* **Testing:** Backend tests in `backend/tests`, frontend tests in `frontend/src/*.test.tsx`.
* **CLI Utilities:** Standalone Node.js scripts inside the `tools/` folder, configured via root `package.json` scripts, to perform database administrative and maintenance operations directly.
* **Style:** Tailwind utility classes are the primary styling method; avoid Vanilla CSS.

* **Typography & Fonts:** The application standard is Google Font 'Outfit' to provide clean, high-readability UI typography, loaded dynamically through the `index.html` head section.

* **User Isolation Standard**: Every endpoint under `/api/gmail` must use `checkJwt` to authenticate users. The database tables (Bronze, Silver, and Gold layers) must strictly isolate records by `user_id` parsed from `req.auth.sub`. In the frontend, the Cognito JWT token retrieved via `fetchAuthSession` must be attached to the `Authorization` header of all API calls.


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

### 3. Architectural Metrics for Success
* **High Cohesion:** Code that changes together must live together. Functions and classes must be highly focused on their singular domain task.
* **Loose Coupling:** Components must be isolated. Changing a database schema, an external API client, or a UI style framework must not trigger a cascade of breaking modifications in the core business logic layers.
