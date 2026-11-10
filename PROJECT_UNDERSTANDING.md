# TalentEdge Project Understanding

## What this project is

TalentEdge is a full-stack web portal for a 40-day campus placement-readiness bootcamp. It is intended to help students prepare for placement drives and help trainers, administrators, and interview panels monitor readiness, run assessments, and evaluate candidates. The supplied brief names TCS NQT, Infosys, Accenture, Cognizant, Capgemini, and Wipro as target recruiters.

## Technology and runtime

- **Frontend:** React 19 and TypeScript, mounted from `src/main.tsx`; Tailwind CSS styles the UI, with Lucide icons, Motion animations, and Recharts visualizations.
- **Backend:** An Express server written in TypeScript and run through `tsx` during development. It hosts Vite middleware in development and serves the built frontend in production.
- **Data store:** MySQL accessed through `mysql2`. The schema is in `talentEdge.sql`; demo data is seeded by `seed-mysql.ts`.
- **AI:** Optional Google Gemini integration through `@google/genai`, configured by `GEMINI_API_KEY`. Server routes provide rule-based responses when no key is configured.
- **Exports:** `jspdf` creates student dossier PDFs; the app also exports batch CSV data.
- **Commands:** `npm run dev` starts the combined development server; `npm run build` builds the frontend and bundles the server; `npm start` runs the production server; `npm run lint` runs TypeScript's no-emit check.

## Main product areas

1. **Role-based portal experience:** The UI can switch among student, trainer, and admin views. Navigation and page selection are managed in `src/App.tsx`.
2. **Student readiness dashboard:** Student profiles combine attendance, bootcamp progress, skill scores, strengths, weak areas, recruiter eligibility, and interview remarks.
3. **40-day curriculum:** `src/data/curriculumData.ts` defines five phases: technical training (days 1–18), aptitude and reasoning (19–26), HR and communication (27–30), technical revision and core CS (31–36), and placement simulation (37–40). The timeline links curriculum days to assessments.
4. **Assessments and coding practice:** Assessment content lives in `src/data/assessmentData.ts`. The assessment player supports MCQ and coding question types, while `CodeEditor.tsx` provides a practice-editor interface.
5. **Interview evaluation:** Technical and HR interview panels capture ratings and remarks. The remarks API updates a student's interview score and recalculates overall readiness.
6. **Trainer and cohort tools:** Batch/student management, analytics, at-risk views, leaderboard, and AI-generated trainer intervention summaries support cohort oversight.
7. **AI insights:** The app requests personalized study recommendations, readiness predictions, and trainer summaries. AI calls are optional and have canned fallback behavior.
8. **Reporting and completion:** Student dossier PDFs, batch CSV exports, and a certificate view are provided.

## Data and backend flow

- Student, batch, and assessment screens now load workspace-scoped records from the authenticated API. Demo profiles remain available only through the optional destructive seed script.
- `server.ts` exposes health, students, batches, notifications, student-remark update, three AI, and code-run endpoints.
- `talentEdge.sql` defines tables for batches, users, student profiles, interview records, assessments, submissions, and notifications. Complex profile properties such as eligibility and remarks are stored as JSON strings in text columns.
- `seed-mysql.ts` inserts demo batches, users, student profiles, and notifications. It truncates the existing demo-related tables before reseeding, so it is a demo-data setup script rather than a non-destructive migration.
- Several screens still use local sample data or component state. For example, notifications shown by `App.tsx` are hardcoded, and the visible API integration persists remarks but does not provide full CRUD for all declared database entities.

## Important implementation boundaries

- The code-run endpoint is a simulator: it does not compile or execute submitted source code. Client fallback behavior reports all test cases as passing if the API request fails. Treat it as demo behavior, not as an accurate or secure online judge.
- Readiness probabilities and the non-AI recommendation/prediction paths are heuristic or static demo content, not validated placement outcome models.
- The supplied brief describes a wider product vision than the persistence currently wired into the UI. The project is best understood as a feature-rich demo/prototype with selected MySQL-backed flows, not a fully integrated production placement system.
- `prisma.config.ts` and the Prisma dependency appear to be tooling/configuration artifacts; the application data layer shown in the source uses direct MySQL queries rather than Prisma models.

## Key files

| File | Purpose |
| --- | --- |
| `src/App.tsx` | Authenticated app state, workspace navigation, data loading, and page composition |
| `src/components/` | Dashboard, curriculum, assessment, interview, analytics, batch, profile, and modal UI |
| `src/data/` | Demo student, curriculum, and assessment datasets |
| `src/types.ts` | Shared TypeScript domain types |
| `src/services/api.ts` | Frontend API calls and fallback behavior |
| `server.ts` | Express endpoints, Gemini integration, MySQL access, and Vite/production serving |
| `talentEdge.sql` | MySQL DDL schema |
| `seed-mysql.ts` | Demo database population script |
| `src/utils/pdfGenerator.ts` | PDF and CSV export helpers |
| `Campus Placement Assessment Portal.docx` | Supplied architecture and feature brief |
| `PRODUCT_SCOPE.md` | Stage 1 product roles, proposed subscription tiers, base release scope, and open commercial decisions |
| `src/types/subscriptions.ts` | Initial typed plan, entitlement, limit, and subscription contracts; not yet enforced by the app |
| `migrate-auth.ts` | Idempotent local MySQL migration for workspace memberships, invitations, sessions, audit events, and batch assignments |
| `LOCAL_SETUP.md` | Local database migration, demo seed, and first administrator setup instructions |

## Stage 3 implementation status

The local app now has email/password sign-in, database-backed sessions, first-admin setup, optional college workspace registration, member invitations and password reset links, college-admin member activation controls, and workspace audit events. Authenticated role membership now drives the UI; students see their own profile, trainers are scoped to assigned batches, and college admins see workspace data. Workspace notifications and leaderboard data are also loaded through tenant-scoped API routes. These features require the `npm run db:migrate-auth` migration before the server can provide authenticated data routes.

