# Jobr UI contract

M1.1 supplies component/API contracts and a smoke-tested app shell. Authenticated screens,
background workers, application submission, and matching UI are later milestones.

| Screen | Main components | Loading / empty / failure | Accessibility |
| --- | --- | --- | --- |
| Sign up | Auth form, OAuth buttons | Pending, auth error, recovery | Form labels, error summary, password autocomplete |
| Onboarding | Resume drop zone, parse status, filter confirmation | Upload progress, retry failed parse | Keyboard file input, live polite progress |
| Resume Studio | Evidence badge, line quote, experience editor | Parse skeleton, no resume, invalid date | Label inferred evidence, focus first error |
| Preferences | Hard filters, commute, salary floor | Saving, no profile, conflict | Fieldsets, units, inline errors |
| Discover | Match cards, search, exclusion reasons | Skeleton, no eligible roles, source unavailable | Semantic list, focusable cards |
| Review Queue | List, explanation drawer, score breakdown | Loading detail, empty queue, verification failure | J/K navigate, A approve prep, R reject, S save; ignore shortcuts inside inputs and dialogs |
| Application Review | Resume diff, screening answers, employer consents | Preparing, missing answer, stale artifact | Focus-trapped dialog, labelled checkboxes, Escape and focus restore |
| Application Tracker | Table / Kanban, timeline, receipts | Loading, no applications, save conflict | Table headers, keyboard stage controls, confirmed/inferred badges with text |

All screens require visible focus, contrast meeting WCAG 2.1 AA, reduced-motion support,
polite status announcements, and text labels for icon-only actions. Loading skeletons are
aria-hidden and paired with a live status label. Errors remain visible until resolved.

Application flow: recommended -> approved_for_preparation -> ready_for_review ->
authorized_for_submission -> submitted. Authorization requires verified factual answers,
ATS consent, an artifact hash and server signature; submitted additionally requires a receipt.
Preparation approval never authorizes submission. Editing prepared material invalidates its
prior authorization. Preparation progress is a worker substate rather than a persisted lifecycle value. Record interview/offer/withdrawn updates as confirmed or inferred;
inferred suggestions require user confirmation. Apply optimistic concurrency at each transition.

The API enum freezes 14 tracker statuses. Backend transition enforcement belongs to T-501.
Render employer descriptions as plain text or sanitize them independently; boundary escaping
for LLM prompts does not authorize HTML rendering. Display source timestamps and source links
from verified ingestion data rather than model output.
