# Public policy authoring

The fourteen Markdown documents in `docs/policies` are the authoring source for both
websites. The CSS and theme script in that directory supply the shared presentation.
Generated HTML lives in each site's `public/policies` directory.

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

Policy pages use the existing public contact email and staff roles. The legal operator
identity remains in documents that identify the accountable operator. Internal staff routing,
project identifiers and deployment evidence belong in operational documentation.

The October 29 revision is a finished-copy candidate on the feature branches. Its revision
date does not establish a production effective date. Publishing the branches, changing
policy acceptance requirements and releasing to the public are separate actions.

The edit preserves the existing eligibility rule, retention periods, response targets,
independent appeal requirement and source-rights limits. Remaining provider-location,
processor-retention, manual accessibility and hosted acceptance evidence is maintained in
the legal and release registers; no additional certification or service guarantee is implied.
