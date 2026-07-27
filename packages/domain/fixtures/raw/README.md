# Raw ADO fixtures

Captured from a live Azure DevOps instance (`api-version=7.1`), then reduced to
**only the fields the raw schemas read**. Free text — comment bodies, PR
descriptions, URLs — is dropped rather than scrubbed: a denylist can always miss
an internal hostname, so nothing free-form is kept at all.

Substitutions:

| Real | Fixture |
|:---|:---|
| org / project / repo names | `acme` / `Alpha` / `alpha-repo` |
| people | `dev1@example.com`, `dev2@example.com`, … |
| review groups | `vstfs:///Classification/TeamProject/{guid}\Review Group` |
| repo GUID | `11111111-1111-4111-8111-111111111111` |
| project GUID | `22222222-2222-4222-8222-222222222222` |
| identity / commit GUIDs | stable SHA-256 derived fakes |

Structure is preserved verbatim, so these exercise the real shapes: vote threads
carry `properties.CodeReviewThreadType.$value === "VoteUpdate"` with a single
`commentType: "system"` comment, container reviewers keep `isContainer: true`,
and completed PRs keep `lastMergeCommit`.

Regenerate only from a live capture — do not hand-edit, or the schemas stop
being tested against reality (07 §10).
