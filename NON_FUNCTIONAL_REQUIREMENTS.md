# Non-Functional Requirements

## Technical Stack [NFR-TECH]
- [NFR-TECH-1] Backend Framework: Node.js with Express.
- [NFR-TECH-2] Frontend Framework: React (scaffolded via Vite).
- [NFR-TECH-3] Language: TypeScript must be used for both frontend and backend for type safety.
- [NFR-TECH-4] Styling: Tailwind CSS for utility-first styling.
- [NFR-TECH-5] Testing: Jest for backend, Vitest/React Testing Library for frontend.

## Architectural Constraints [NFR-ARCH]
- [NFR-ARCH-1] SOLID Design: All modules must adhere to SOLID principles (SRP, OCP, LSP, ISP, DIP).
- [NFR-ARCH-2] Clean Code: All functions and components must follow Clean Code standards (meaningful names, < 20 lines per function, etc.).
- [NFR-ARCH-3] Backend Structure: Must maintain a clear separation between routes, controllers, and services.

## Performance & Reliability [NFR-PERF]
- [NFR-PERF-1] Health Check: The backend must expose a `GET /api/health` endpoint returning `{"status": "ok"}` within 100ms.
- [NFR-PERF-2] Responsiveness: The UI must be responsive using Tailwind's layout utilities.
