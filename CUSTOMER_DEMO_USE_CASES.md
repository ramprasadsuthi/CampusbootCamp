# TalentEdge Customer Demo and Test Scenarios

Use these scenarios to demonstrate real workflows in TalentEdge and to confirm that changes persist through the live application. Each demo uses college, trainer, panelist, and student accounts connected to the same workspace. Do not use real student personal data in a customer demo; use clearly identified demo accounts.

## Demo setup

### Recommended demo accounts

Prepare these accounts in one demo workspace:

| Account | Role | Purpose |
| --- | --- | --- |
| College administrator | `college_admin` | Configure the workspace and manage members, batches, schedules, and reports |
| Trainer | `trainer` | Review assigned batch progress and evaluate students |
| Interview panelist | `panelist` | Complete an assigned interview evaluation |
| Student A | `student` | Demonstrate the student learning journey |
| Student B | `student` | Compare progress and show batch-level reporting |

For local setup, follow [LOCAL_SETUP.md](LOCAL_SETUP.md). Create the database schema, run `npm run db:migrate-auth`, optionally seed demo records with `npm run db:seed`, then start with `npm run dev`. The seeder is non-destructive and repeatable. If the database has multiple workspaces, pass `--workspace=<workspace-id>` to choose where demo records belong. Create password-backed demo accounts through workspace invitations. Create a separate platform administrator using the setup flow in `LOCAL_SETUP.md` if you plan to show the platform console.

Before a customer session, sign in once with each demo account and confirm that all accounts belong to the intended workspace. Ensure the sample assessments are available. If you need demo interview schedules or an initialized subscription, create them through the college administrator UI and verify their saved state before presenting.

## Scenario 1: A student starts the placement-readiness journey

**Customer story:** A student signs in, sees what to do next, opens an assessment, and checks their own progress.

**Actors:** Student A.

**Steps:**

1. Sign in as Student A and open the Bootcamp Dashboard.
2. Point out the saved course progress, next curriculum action, assessments, and trainer feedback area.
3. Select **Continue course** or open the 40-Day Roadmap.
4. Open an available day’s lesson or learning material. Mark the material reviewed if that action is available.
5. Return to assessments, start a live assessment, answer a few questions, and submit.
6. Reopen the dashboard and assessment list to show the updated attempt status and score.
7. Open Profile & Readiness and download the student report.

**Expected result:** The student sees only their own learning progress, attempts, feedback, and profile. A submitted attempt appears in their assessment status and is retained when the view is revisited.

**Demo note:** Material review is student-reported. Day completion and learning-check behavior varies by curriculum day; do not imply every day has automatic completion checks.

## Scenario 2: An administrator enrolls a student into a batch

**Customer story:** A college administrator creates a training batch, invites students, and assigns a trainer so the right people see the right students.

**Actors:** College administrator, Trainer, Student A.

**Steps:**

1. As college administrator, open **Batches & Colleges** and create a batch with a name, start date, completion date, and trainer assignment.
2. Open **Workspace Members** and invite Student A with the student role, selecting the new batch.
3. Copy the invitation link and accept it in a separate browser session as Student A.
4. Sign in as the trainer and open **Assigned Batches**.
5. Open the batch and student profile to review the assigned student’s progress.

**Expected result:** The new batch appears in the admin view; the invited member becomes an active student after accepting the link; the trainer can access the assigned batch and student data.

**Demo note:** Invitation links are created in the app but are not emailed automatically. Deliver demo invitation links through a controlled channel.

## Scenario 3: Trainer feedback appears in the student experience

**Customer story:** A trainer evaluates a student and the student can act on the feedback.

**Actors:** Trainer, Student A.

**Steps:**

1. Sign in as trainer and open the technical or HR interview panel.
2. Select Student A, enter rubric scores, a recommendation, and specific written feedback, then save.
3. Sign in as Student A in another browser session and open **Mock Interview Scores** or the dashboard feedback area.
4. Review the saved score and remarks.
5. Return as trainer and open the student again to confirm the evaluation remains saved.

**Expected result:** The evaluation is available to the student and reflected in interview/readiness information. The student cannot edit the trainer’s saved evaluation.

**Demo note:** Readiness values are product estimates and should be presented as guidance, not a guarantee of placement outcomes.

## Scenario 4: Schedule an interview and complete it as a panelist

**Customer story:** An administrator schedules a mock interview, the panelist evaluates it, and the student sees the result.

**Actors:** College administrator, Interview panelist, Student A.

**Steps:**

1. As administrator, add or select an interview panelist and open **Interview Panels**.
2. Create a future technical or HR interview for Student A. Add a duration, location or meeting link, and preparation notes.
3. Confirm the schedule appears in the admin schedule list.
4. Sign in as the assigned panelist and open **Assigned Interviews**.
5. Submit the rubric evaluation and written feedback for the scheduled interview.
6. Sign in as Student A and open interview results to review the appointment and completed evaluation.
7. As administrator, open interview reports and filter to the scheduled interview or date range.

**Expected result:** The schedule is visible to the assigned panelist and the student. After evaluation, the saved score, recommendation, remarks, and lifecycle appear in the appropriate views and report.

**Demo note:** Use a future time in the correct timezone and a non-sensitive meeting link. Schedule delivery is in-app; the app does not send calendar invitations or email reminders.

## Scenario 5: Turn batch data into a targeted intervention

**Customer story:** A college administrator identifies students who need support and exports a report for follow-up.

**Actors:** College administrator, Trainer.

**Steps:**

1. As administrator, open **System Settings** and review the at-risk and Tier 1 readiness thresholds.
2. Open the dashboard or analytics and identify a batch/student that needs attention.
3. Open **Reports & Export** and create a readiness or activity report. Apply available filters and date range.
4. Export the filtered CSV or a selected student PDF.
5. As trainer, review the assigned batch and use the AI trainer summary if configured.
6. Record the agreed intervention through the existing feedback/evaluation workflow.

**Expected result:** Threshold changes are saved for the workspace; reports reflect the selected filters; exports download; trainer views remain scoped to assigned batches.

**Demo note:** AI features can fall back to heuristic/static text when Gemini is unavailable. Explain any fallback as a suggested summary, not an authoritative diagnosis.

## Scenario 6: Show operational controls for a college workspace

**Customer story:** A platform operator can provision a college and inspect its operational status without opening student-level records.

**Actors:** Platform administrator, College administrator.

**Steps:**

1. Open `/platform-admin` and sign in with the separate platform admin account and authenticator code.
2. In **Colleges**, create a demo workspace and first college administrator invitation, or open an existing demo workspace.
3. Review workspace lifecycle, plan assignment, and usage metadata.
4. Open **Plans** to review configured plan limits, then **Subscription history** to review recorded changes.
5. Open **Shared content** to show draft/published releases, rollout status, and application history. If applying a release, use a demo workspace and review the content before applying.
6. Open **Audit log** to show that administrative actions are recorded.

**Expected result:** The platform console shows cross-college operational metadata, supports manual workspace/plan operations, and keeps an audit trail. College workspace data remains separate from the platform admin account.

**Demo note:** Plan assignment is manual. Billing, payment processing, invoices, and automated email delivery are not part of the current demo.

## Fast 10-minute customer walkthrough

For a short session, use this order:

1. **Student, 2 minutes:** dashboard → roadmap → submit an assessment → profile.
2. **Trainer, 2 minutes:** assigned batch → student progress → save feedback.
3. **Student, 1 minute:** reopen results and see feedback.
4. **Administrator, 3 minutes:** create/inspect batch → schedule an interview → reports and CSV export.
5. **Platform, 2 minutes:** workspace overview → plans/usage → shared content and audit log.

If time is limited, pre-create the student, batch, assessment, panelist, and schedule. Leave one small change (such as feedback or an evaluation) to perform live so the customer sees the saved state update across roles.

## Quick acceptance checklist

- [ ] Student, trainer, panelist, and administrator accounts can sign in.
- [ ] Student can access own learning, assessments, profile, and interview results.
- [ ] Trainer sees assigned batches and can save feedback/evaluation.
- [ ] Student sees the newly saved feedback/evaluation after refresh or navigation.
- [ ] Administrator can invite a member, assign a batch, and manage an interview schedule.
- [ ] Report filters and CSV/PDF exports work with the selected demo records.
- [ ] Platform admin can sign in with MFA and see workspace and audit information.
- [ ] Demo workspace contains no real student personal information.

## Known demo boundaries

- The coding sandbox simulates code-run outcomes; it is not an execution service.
- AI availability depends on Gemini configuration; fallback responses are not model-generated.
- Readiness scores and predictions are advisory estimates.
- Invitations are copied and delivered manually; there is no configured email service.
- Subscription limits are enforced for selected operations, while payment and invoice workflows are not implemented.
- Some screens and data may use seeded or local sample content. Confirm the records you plan to show are database-backed in your target environment.
