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

- The frontend starts with sample profiles from `src/data/mockData.ts` and attempts to replace them with `/api/students` data when the server responds.
- `server.ts` exposes health, students, batches, notifications, student-remark update, three AI, and code-run endpoints.
- `talentEdge.sql` defines tables for batches, users, student profiles, interview records, assessments, submissions, and notifications. Complex profile properties such as eligibility and remarks are stored as JSON strings in text columns.
- `seed-mysql.ts` inserts demo batches, users, student profiles, and notifications. It truncates the existing demo-related tables before reseeding, so it is a demo-data setup script rather than a non-destructive migration.
- Several screens still use local sample data or component state. For example, notifications shown by `App.tsx` are hardcoded, and the visible API integration persists remarks but does not provide full CRUD for all declared database entities.

## Important implementation boundaries

- The code-run endpoint is explicitly a **simulator**: it does not compile or execute submitted source code. It returns expected outputs for ordinary snippets and only changes behavior for specific marker strings. Client-side fallback behavior also reports all test cases as passing if the API request fails. Treat this as a UI/demo feature, not a secure or accurate online judge.
- Readiness probabilities and the non-AI recommendation/prediction paths are heuristic or static demo content, not validated placement outcome models.
- The supplied brief describes a wider product vision than the persistence currently wired into the UI. The project is best understood as a feature-rich demo/prototype with selected MySQL-backed flows, not a fully integrated production placement system.
- `prisma.config.ts` and the Prisma dependency appear to be tooling/configuration artifacts; the application data layer shown in the source uses direct MySQL queries rather than Prisma models.

## Key files

| File | Purpose |
| --- | --- |
| `src/App.tsx` | App state, role and navigation switching, data loading, and page composition |
| `src/components/` | Dashboard, curriculum, assessment, interview, analytics, batch, profile, and modal UI |
| `src/data/` | Demo student, curriculum, and assessment datasets |
| `src/types.ts` | Shared TypeScript domain types |
| `src/services/api.ts` | Frontend API calls and fallback behavior |
| `server.ts` | Express endpoints, Gemini integration, MySQL access, and Vite/production serving |
| `talentEdge.sql` | MySQL DDL schema |
| `seed-mysql.ts` | Demo database population script |
| `src/utils/pdfGenerator.ts` | PDF and CSV export helpers |
| `Campus Placement Assessment Portal.docx` | Supplied architecture and feature brief |

