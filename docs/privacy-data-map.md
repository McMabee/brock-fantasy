# Privacy Data Map

| Data                              | Purpose                             | Access                        | Deletion behavior                                                                |
| --------------------------------- | ----------------------------------- | ----------------------------- | -------------------------------------------------------------------------------- |
| Auth email and credentials        | Account access and recovery         | User and auth service         | Deleted with auth account                                                        |
| Display name and optional avatar  | League identity                     | User's league members         | Profile deleted; historical ownership anonymized                                 |
| League/team membership            | Fantasy competition                 | League members and admins     | Membership deleted; orphaned team retained without owner where audit is required |
| Draft, roster, and scoring events | Competition integrity               | League members and admins     | Retained as non-personal competition record                                      |
| Chat messages/reports/mutes       | League communication and moderation | Applicable members/admins     | Subject to approved retention; author can be anonymized                          |
| Provider snapshots and mappings   | Auditable scoring/replay            | Administrators                | Retained by sports-data policy                                                   |
| Audit log                         | Security and corrections            | Administrators                | Actor reference anonymized after account deletion                                |
| Push token                        | Mobile notifications                | User and notification service | Deleted with account                                                             |

Do not collect student number, phone number, birth date, precise location, or unrelated profile data.
Tarik Merchant owns privacy/legal approval, support, accessibility, and game-day operation. Finalize the
legal operator, retention periods, subprocessors/data-hosting locations, privacy notice, and access roles
before production. Ty Mabee owns security-incident escalation and release management.
