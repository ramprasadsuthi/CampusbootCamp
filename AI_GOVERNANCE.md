# Readiness scoring and AI governance

## Readiness score

TalentEdge uses the deterministic `readiness-weighted-v1` score. It is a weighted average of eight current competency indicators:

| Indicator | Weight |
| --- | ---: |
| Coding and DSA | 25% |
| Aptitude | 15% |
| Reasoning | 10% |
| SQL and database | 10% |
| CS fundamentals | 10% |
| Communication | 10% |
| Technical interview | 10% |
| HR interview | 10% |

Each input is clamped to 0–100. When a value is genuinely absent, its weight is excluded and the remaining weights are rescaled. The student profile exposes the score, inputs, weights, and weighted contributions. Workspace Tier 1 and at-risk thresholds classify the score; these labels are training indicators, not hiring decisions.

## Placement outcome evaluation

Company clearance is not represented as a probability. The current `readiness-weighted-v1` result is an indicator, and the Tier 1 threshold is recorded with each prediction event. A college administrator can record the later outcome as placed or not placed. The workspace evaluation endpoint reports the confusion counts, precision, and recall for labeled events; fewer than 30 outcomes is marked insufficient data, and all metrics remain descriptive rather than calibrated probabilities. Outcome labels are audit logged and workspace-scoped.

Outcome labels can be incomplete or biased by hiring cycles, employer mix, and which students receive offers. Do not use these metrics to rank candidates or automate employment decisions. Revisit the model and thresholds before any broader claim.

## External AI processing

- External provider calls are disabled unless `AI_EXTERNAL_PROCESSING_ENABLED=true` and `GEMINI_API_KEY` is set on the server.
- Readiness indicators do not call a generative model. Training recommendations use workspace-stored skill scores and weak-area labels, without sending names, email addresses, roll numbers, or student IDs. Trainer summaries use anonymous batch aggregates and skill averages.
- AI output is advisory. Trainers must check generated recommendations before acting on them. AI must not make admissions, hiring, discipline, or placement decisions.
- Successful provider calls consume workspace AI credits. Local deterministic fallbacks do not.
- Prediction evidence contains the model version, competency indicators, and thresholds needed to explain the result. It does not contain names or free-text student remarks.
- Prediction events and outcomes are retained with the workspace and removed when that workspace is deleted. Existing provider retention and processing terms remain governed by the configured provider account.

## Operational endpoints

- `POST /api/ai/predict-readiness` records a versioned readiness indicator for an authorized student.
- `PATCH /api/ai/predictions/:id/outcome` records a placement outcome for a workspace event (college administrator capability).
- `GET /api/ai/predictions/pending` lists unlabeled events for college administrators so outcomes can be recorded later.
- `GET /api/ai/prediction-evaluation` returns aggregate evaluation metrics to college administrators.

Apply the new schema with `npm run db:migrate-auth` before recording prediction events. External AI remains off until the operator explicitly enables it.
