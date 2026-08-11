# External Contribution Automation

## Overview

Add automation that prioritizes external contributions, enforces a five-business-day first-response SLA, alerts maintainers through GitHub, and highlights external contributors in GitHub releases.

## Approved Plan

1. Label and welcome external issues and pull requests when they become ready for maintainer attention.
2. Check the first-response SLA hourly on weekdays and emit one alert per breach.
3. Resolve active SLA alerts when a maintainer comments on an issue or comments/reviews a pull request.
4. Generate GitHub release notes on version tags and maintain a dedicated external-contributor acknowledgment.
5. Document configuration and validate the workflow logic with focused tests.

## Decisions

- The SLA is five business days, excluding Saturdays and Sundays.
- SLA breaches mention `@kubefleet-dev/kubefleet-maintainers`.
- Owners, organization members, and repository collaborators are internal; all other human authors are external.
- Release automation preserves hand-written release content outside its marker-delimited section.

## Status

- [x] Existing intake and release automation reviewed.
- [x] Implementation plan approved.
- [x] SLA automation implemented.
- [x] Release contributor recognition implemented.
- [x] Documentation and tests completed.

## Implementation Notes

- Added an idempotent intake path for external, non-bot authors. Draft pull requests begin their SLA when marked ready for review.
- Scheduled checks preserve the exact intake time while skipping Saturdays and Sundays.
- An overdue contribution receives the temporary `sla:overdue` label and one marker-delimited maintainer alert.
- Maintainer comments and pull request reviews clear the active overdue label.
- Tag releases generate notes when needed and preserve hand-written content when updating the marker-delimited external-contributor section.
- Teams, individual account mentions, automatic assignments, and digest issues are intentionally excluded.

## Validation

- Node.js tests: 8 passed.
- JavaScript syntax checks: passed.
- Workflow YAML and automation JSON parsing: passed.
- Tracked and untracked whitespace checks: passed.
