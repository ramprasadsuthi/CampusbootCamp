# Local account and workspace setup

Stages 3 and 4 add local authentication, college workspace boundaries, and persistent tenant-scoped learning workflows on top of the existing MySQL database.

## One-time database setup

1. Create the database schema from `talentEdge.sql` in your local MySQL instance.
2. Add the DB connection values and a unique `AUTH_BOOTSTRAP_TOKEN` to `.env`. Keep the token private; the initial administrator setup turns off after the first password-backed account exists.
3. Apply the authentication, workspace, and tenant workflow migration:

   ```powershell
   npm run db:migrate-auth
   ```

   The migration creates workspace student profiles, trainer assignments, per-student curriculum progress, Day 1 learning-material catalog and student material progress, adds workspace ownership to batches, assessments, submissions, and interview records, and copies the sample assessment catalog into each existing workspace. It is safe to rerun; it does not remove existing records.

4. For the optional demonstration data, run the destructive demo seeder **before** creating the first administrator:

   ```powershell
   npm run db:seed
   ```

   The seeder clears demo users, profiles, batches, invitations, sessions, and workspace memberships before repopulating sample records. Do not run it against data you need to keep.

5. Start the app locally:

   ```powershell
   npm run dev
   ```

6. Open `http://127.0.0.1:3000`. Use **Set up the first college administrator** and provide the bootstrap token from `.env`. The first setup creates the college administrator and binds the browser session to the workspace.

If demo data was seeded, each demo user can be invited from **Workspace Members** to create a password-backed account. New member invitations are shown as links to copy; email delivery is not part of this local stage.

For local multi-college development, set `ALLOW_WORKSPACE_REGISTRATION=true` in `.env` to show the workspace creation option. It is disabled by default and should stay disabled in any public environment until email verification and abuse controls are implemented.

## Security behavior in this stage

- Passwords are stored as salted scrypt hashes, never as plaintext.
- Sessions use random opaque tokens stored as SHA-256 hashes in MySQL and sent in HttpOnly, SameSite=Lax cookies.
- College roles are stored in workspace memberships. The former role switcher is removed.
- Student, trainer, batch, leaderboard, notification, and interview remark API queries apply workspace and role scope server-side.
- Student profiles and batch assignments are stored per workspace. College administrators can manage batches, assign trainers and students, and invite students directly into a batch.
- Curriculum completion is stored per student and workspace. Assessment submission status and attempt counts are derived from that student's own submission records.
- Day 1 supports workspace-managed video links, text readings, and PDF links, with per-student material review progress. Day 1 no longer accepts a manual student day-completion action; automatic completion and learning checks are planned for the next stage. Video/document review is currently self-reported, and resource files must be hosted at an accessible HTTPS URL.
- Assessments, submissions, and interview evaluation history are stored with workspace ownership. Student-facing assessment responses omit answer keys.
- College administrators can invite and deactivate workspace members. Deactivation revokes that member's sessions for the workspace; the last active college administrator cannot be deactivated.
- Workspace invitation links expire after seven days and can be accepted once.
- A college administrator can create a one-time password reset link for an active member. Reset links expire after one hour, and using one revokes the member's existing sessions. In a local setup, send the link through a verified channel yourself.

This is a local foundation. Email delivery, external identity providers, distributed login throttling, billing, and cloud deployment are not configured yet. Local college registration does not verify email addresses; keep it disabled in any public environment until verification and abuse controls are implemented.
