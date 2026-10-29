# Public policy authoring

The fourteen Markdown documents in `docs/policies` are the authoring source for both
websites. The CSS and theme script in that directory supply the shared presentation.
Generated HTML lives in each site's `public/policies` directory. Both copies share
the same policy text, section anchors and navigation. The `data-policy-site`
attribute selects each site's colours while preserving the shared document layout.

Install the pinned renderer with `python -m pip install -r scripts/requirements-policies.txt`.
With both checkouts beside each other, run:

```powershell
pnpm policies:generate
pnpm policies:check
pnpm test:policies:browser
```

Use `--association-root` with the Python exporter if the association checkout is elsewhere.
Generation deliberately requires both checkouts so the shared policy copies cannot silently
diverge. The exporter applies each repository's existing JavaScript formatting convention.

Policy pages use `bfa.support64@gmail.com` for public support and privacy requests.
Staff responsibilities use role names. The legal operator
identity remains in documents that identify the accountable operator. Internal staff routing,
project identifiers and deployment evidence belong in operational documentation.

Revision dates identify the policy copy and do not establish a new consent requirement.
Publication and changes to policy acceptance requirements remain separate decisions.

The edit preserves the existing eligibility rule, retention periods, response targets,
independent appeal requirement and source-rights limits. Remaining provider-location,
processor-retention, manual accessibility and hosted acceptance evidence is maintained in
the legal and release registers; no additional certification or service guarantee is implied.
