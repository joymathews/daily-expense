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

## Gmail Integration [FUNC-GMAIL]
- [FUNC-GMAIL-1] Navigation: The user must be able to navigate to the Gmail Fetcher service through the primary navigation menu.
- [FUNC-GMAIL-2] Configuration: The user must be able to define granular filters to target specific expenses. At least one Sender Email and a Date Range (start and end date) are mandatory. The Subject filter is optional.
- [FUNC-GMAIL-3] Authentication: The user must be prompted to authorize the system to access their Google account via a secure OAuth2 popup.
- [FUNC-GMAIL-4] Display: The system must display fetched transaction data in a high-density table showing Date, Sender, and Transaction Details.
- [FUNC-GMAIL-5] Pagination: The system must retrieve all matching emails for the specified filters by automatically paginating through the Gmail API results.
- [FUNC-GMAIL-6] Email Segregation: The system must automatically analyze fetched emails and categorize them into two lists: "with transaction" and "without transaction" based on transactional keywords in the subject or body snippet.
- [FUNC-GMAIL-7] Separate Presentation: The system must display the two lists of emails (transactional and non-transactional) in separate sections or tabs to the user.
- [FUNC-GMAIL-8] Manual Review: The system must provide options for the user to manually review and move emails between the "with transaction" and "without transaction" sections.
