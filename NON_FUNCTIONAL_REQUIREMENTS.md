# Non-Functional Requirements

## Security [NFR-SEC]
- [NFR-SEC-1] Identity Management: The system must use a centralized identity provider for all user authentication.
- [NFR-SEC-2] API Protection: All non-public API endpoints must require a valid, verified security token for access.
- [NFR-SEC-3] Token Validation: Security tokens must be validated against a trusted public key set (JWKS) on every request.

## Performance & Reliability [NFR-PERF]
- [NFR-PERF-1] Health Monitoring: The system must expose a health check endpoint that responds within 100ms to allow external uptime monitoring.
- [NFR-PERF-2] Responsive Design: The user interface must be fully functional and aesthetically consistent across desktop, tablet, and mobile screen resolutions.

## Availability [NFR-AVAIL]
- [NFR-AVAIL-1] The system should target 99.9% uptime for the authentication and dashboard services.
