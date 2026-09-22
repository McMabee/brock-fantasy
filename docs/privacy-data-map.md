# Privacy Data Map

| Data                              | Purpose                             | Access                        | Deletion behavior                                                                |
| --------------------------------- | ----------------------------------- | ----------------------------- | -------------------------------------------------------------------------------- |
| Auth email and credentials        | Account access and recovery         | User and auth service         | Deleted with auth account                                                        |
| Display name and optional avatar  | League identity                     | User's league members         | Profile deleted; historical ownership anonymized                                 |
| League/team membership            | Fantasy competition                 | League members and admins     | Membership deleted; orphaned team retained without owner where audit is required |
| Draft, roster, and scoring events | Competition integrity               | League members and admins     | Retained as non-personal competition record                                      |
| Chat messages/reports/mutes       | League communication and moderation | Applicable members/admins     | Subject to approved retention; author can be anonymized                          |
| Provider snapshots and mappings   | Auditable scoring/replay            | Administrators                | Retained by sports-data policy                                                   |
| Ingestion incident reasons        | Competition-scoped incident control | AAL2 administrators           | Retained in the audit log under the incident policy                              |
| Audit log                         | Security and corrections            | Administrators                | Actor reference anonymized after account deletion                                |
| Push token                        | Mobile notifications                | User and notification service | Deleted with account                                                             |
| Sponsor daily counts              | Aggregate campaign reporting        | Sponsor admins                | No user identifier collected                                                     |

Do not collect student number, phone number, birth date, precise location, or unrelated profile data.
Finalize retention periods, subprocessors, privacy notice, and access roles with Brock's privacy owner
before production.
