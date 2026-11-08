# AGENTS.md — Developer & AI Agent Guidelines

This document provides architectural rules, project conventions, and operational guidelines for AI agents and developers working on the `villages-online` codebase.

---

## 1. Project Overview & Architecture

`villages-online` is a real-time multiplayer 3D voxel/terrain village game and world builder. It is organized as a Yarn Berry workspace monorepo.

### Monorepo Structure

```
villages-online/
├── apps/
│   ├── web/          # Player client (Next.js 15, React 19, Babylon.js 8)
│   ├── editor/       # 3D Map Editor (Next.js 15, Babylon.js 8)
│   ├── gateway/      # REST API & Session Gateway (Express 5, Redis 7, PostgreSQL 16)
│   └── realm/        # Authoritative Realm simulation & WS server (Express 5, ws 8)
├── packages/
│   ├── shared/       # Shared DTOs, protocol contracts, physics & world constants
│   └── world/        # Chunk math, terrain scene generation, height query, map asset I/O
├── infra/            # PostgreSQL initialization schemas and Docker dev tooling
├── scripts/          # Container and image build scripts (build-image.mjs)
└── tests/            # End-to-end integration test suites (Playwright)
```

---

## 2. Package Management & Tooling

- **Package Manager**: Yarn Berry `4.9.1` with `nodeLinker: node-modules`.
- **Corepack**: Always use Corepack to invoke Yarn (`corepack enable` / `corepack yarn <command>`). Do not use `npm` or legacy `yarn 1.x`.
- **Workspaces**: Internal packages (`@villages/shared`, `@villages/world`) use `"workspace:*"` dependencies.
- **Node Environment**: Node `v20.x` or later (tested on Node `v24.x`).

---

## 3. Essential Commands & Verification

Always run tests, linting, and typechecks after making changes:

```bash
# Run all unit and integration tests (Vitest)
yarn test

# Lint all files across the monorepo (ESLint)
yarn lint

# Fix auto-fixable lint issues
yarn lint:fix

# Typecheck all workspaces and apps
yarn typecheck

# Full production build of all workspaces
yarn build

# Format check with Prettier
yarn format:check
yarn format
```

---

## 4. Architectural Rules & Technical Conventions

### 4.1. Coordinate Systems & Babylon.js Meshes

- **Coordinate System**: Left-handed 3D Cartesian coordinates (`X` is right, `Y` is up, `Z` is forward/depth).
- **Chunk Layout**:
  - Chunks are square 2D blocks positioned on an integer grid `(chunk.x, chunk.z)`.
  - Chunk ID format is `${x}:${z}` (e.g. `"0:0"`, `"-1:2"`).
  - World size of a chunk is `chunk.size` units (e.g. 128 units).
  - Chunk resolution is `chunk.resolution` subdivisions (e.g. 64x64 height samples).
- **Babylon.js Ground Mesh Offsets**:
  - `MeshBuilder.CreateGround` creates meshes centered at `(0, 0, 0)` in local space.
  - Local coordinates span `[-chunk.size / 2, chunk.size / 2]`.
  - The mesh is positioned in world space at:
    $$\text{worldX} = \text{chunk.x} \times \text{chunk.size} + \frac{\text{chunk.size}}{2}$$
    $$\text{worldZ} = \text{chunk.z} \times \text{chunk.size} + \frac{\text{chunk.size}}{2}$$
  - **Important**: To find the world coordinates of a vertex from `getVerticesData(PositionKind)`, you must add `mesh.position.x` and `mesh.position.z` to the local vertex coordinates!
- **Height Map Row Orientation**:
  - Map heights are stored as a 2D array `heights[row][column]`.
  - In world space, `row = 0` corresponds to min Z, and `row = heights.length - 1` corresponds to max Z.
  - In Babylon.js `CreateGround`, row 0 starts at max Z. Therefore, mesh height assignment reverses rows:
    $$\text{meshRow} = \text{heights.length} - 1 - \text{row}$$

### 4.2. Authoritative Simulation (`apps/realm`)

- **Authoritative Physics**: The Realm server is authoritative over all entity positions, velocity, gravity, jumping, and collision. Clients only send directional intents (`{ x, z }`) and jump actions (`jump`).
- **Tick Rate**: Fixed simulation rate at `TICK_RATE = 20` Hz (50ms interval).
- **Grounding Calculation**:
  - Ground level for an entity at `(x, z)` is `getHeightAt(map, x, z) + 1` (accounting for the 1-unit entity center height offset).
  - Jump velocity `JUMP_VELOCITY` is applied only when the entity is grounded: `Math.abs(position.y - ground) < 0.01`.
- **NPC Behaviors**:
  - `standing`: Stationary NPC, continuously kept grounded on terrain height updates.
  - `patrol`: Steps sequentially through `points: Vector3Like[]`. Advances to next point when within distance `< 0.25`.
  - `wandering`: Picks random coordinates within `radius` of `home` and navigates toward them.

### 4.3. Gateway & Authentication (`apps/gateway`)

- **Guest Authentication**:
  - Guest requests provide a `nickname` and optional `existingToken`.
  - Tokens are hashed using SHA-256 (`crypto.createHash("sha256").update(token).digest("hex")`) prior to database storage in `players.token_hash`.
  - Sessions are stored in Redis at key `session:<playerId>` with a 14-day TTL.
- **Realm Tickets**:
  - Gateway issues opaque UUID join tickets via `POST /realms/:realmId/join-ticket`.
  - Tickets are validated and claimed by Realm when the client connects to WebSocket `/ws`.

### 4.4. Next.js & TypeScript Monorepo Rules

- **Transpiled Packages**:
  - `apps/web/next.config.ts` and `apps/editor/next.config.ts` must declare `transpilePackages: ["@villages/shared", "@villages/world"]`.
- **TypeScript Imports**:
  - ESLint enforces `@typescript-eslint/consistent-type-imports` with `prefer: "type-imports"` and `fixStyle: "separate-type-imports"`.
  - Avoid inline `import(...)` type annotations in source files (e.g. use `import type { StandardMaterial } from "@babylonjs/core"` instead of `import("@babylonjs/core").StandardMaterial`).
- **ESLint Ignores**:
  - `eslint.config.mjs` must maintain global ignores for `**/.next/**`, `**/dist/**`, `**/node_modules/**`, and `**/next-env.d.ts`.
- **Vitest Path Aliases**:
  - `vitest.config.ts` must maintain path aliases pointing directly to TypeScript source files (`packages/shared/src/index.ts`, `packages/world/src/index.ts`, `packages/world/src/asset-store.ts`) so tests run without requiring pre-compiled `dist/` artifacts.

---

## 5. Map Assets & Editor

- **Asset Storage**: Maps are stored as JSON files under `packages/world/assets/` (e.g., `starter-valley.json`).
- **Asset Schema Version**: Version `1` (`MAP_ASSET_VERSION = 1`).
- **Modifying Assets**:
  - Use functions in `packages/world/src/editor.ts` (`addChunk`, `removeChunk`, `sculptTerrain`, `paintWater`, `updateNpcDefinition`) to produce immutable updated `MapAsset` objects.
  - Ensure any test asserting map heights or entity positions accounts for the active map scale (`chunkSize` and `chunkResolution`).

---

## 6. Git & Collaboration Workflow

### 6.1. Branching Strategy

- **Base Branch**: `main` is the primary authoritative branch. Never commit directly to `main` for non-trivial features.
- **Branch Naming Conventions**:
  - `feat/<task-id>-<short-description>` or `feat/<description>` — New features or tools
  - `fix/<task-id>-<short-description>` or `fix/<description>` — Bug fixes & regressions
  - `refactor/<task-id>-<short-description>` — Code reorganization without behavior changes
  - `docs/<task-id>-<short-description>` — Documentation & specification updates
  - `codex/<short-description>` — AI agent task branches

### 6.2. Commit Message Convention

Commits follow a structured Conventional Commits format with a task identifier:

$$\text{<type>}(\text{<scope>}): \text{<TASK-ID> } \text{<Commit Message>}$$

- **Format**: `<type>(<scope>): villages#1 Commit Message` or `<type>(<scope>): TASK-0 Commit Message`
  - **Kanzo ID Requirement**: For all features (`feat`), bug fixes (`fix`), refactoring (`refactor`), and performance tasks (`perf`), agents **must always** use the associated Kanzo task ID (e.g. `villages#1`). Never use `TASK-0` for feature branches, feature commits, or pull requests.
  - **No Unlinked Tasks**: If working on a feature or bug not yet on the Kanzo board, agents must create a task card on Kanzo first (`kanzo.create_task`) and use the assigned ID (`villages#<number>`).
  - **Strict TASK-0 Policy**: `TASK-0` is strictly reserved for administrative repo maintenance, root documentation updates, or tooling chores (e.g. `docs(root): TASK-0 ...`, `chore(root): TASK-0 ...`).
  - The commit message should be in the imperative mood and capitalized (e.g. `Add ...`, `Fix ...`, `Update ...`).
- **Types**:
  - `feat`: New user-facing or editor feature
  - `fix`: Bug fix
  - `refactor`: Code refactoring without behavior change
  - `perf`: Performance optimization
  - `test`: Adding or correcting tests
  - `docs`: Documentation updates
  - `chore`: Dependency updates, build configs, or maintenance
- **Scopes**:
  - Apps: `web`, `editor`, `gateway`, `realm`
  - Packages: `shared`, `world`
  - Monorepo: `infra`, `scripts`, `root`
- **Examples**:
  - `feat(editor): villages#1 Add sparse delta undo stack`
  - `fix(realm): villages#2 Filter snapshot replication to AoI chunks`
  - `feat(web): villages#3 Add multi-channel WoW chat HUD`
  - `docs(root): TASK-0 Add Git workflow documentation to AGENTS.md`
  - `test(gateway): TASK-18 Add auth token expiration test suite`

### 6.3. Repository Cleanliness & Artifact Hygiene

- **Untracked / Ignored Artifacts**: Never stage or commit generated build artifacts or caches (`**/dist/**`, `**/.next/**`, `**/node_modules/**`, `**/coverage/**`, or `.yarn/install-state.gz`).
- **Formatting**: Always run `yarn format` or format modified files before committing.

### 6.4. Pull Request Lifecycle

1. Branch from up-to-date `main` (`git fetch origin && git checkout -b feat/TASK-X-name origin/main`).
2. Make atomic, focused commits following the naming convention.
3. Verify all automated checks pass locally before opening or merging a PR (see Checklist below).
4. Target `main` for all Pull Requests.

---

## 7. Kanzo Task Management & Development Workflow

The self-hosted Kanzo board (`kanzo` MCP server) manages all planned features, bug fixes, and development cycles for the `villages-online` repository.

### 7.1. Kanzo Project Structure

- **Project Slug**: `villages`
- **Linked Repository**: `mrAnomalyy/villages-online`
- **Task Identifier Format**: `villages#<number>` (e.g. `villages#1`, `villages#2`).
- **Board Columns**:
  - `todo`: Backlog of planned features and bugfixes awaiting implementation.
  - `doing`: Active task currently under development by the agent or human.
  - `review`: Implemented and locally verified task ready for human review or deployment.
  - `done`: Completed task. **Important**: Agents must leave moving tasks to `done` to the human developer.

### 7.2. Agent Standard Operating Procedure (SOP)

When starting a coding session, picking up a task, or receiving user requests:

1. **Pick Up / Start a Task**:
   - Query existing tasks: `kanzo.list_tasks(project="villages")`.
   - Take the next prioritized card from `todo`: `kanzo.next_task(project="villages")` (automatically transitions card to `doing`).
   - Or start a specific task: `kanzo.update_task(id="villages#<id>", status="doing")`.
   - If working on a new unlisted bug or feature: `kanzo.create_task(title="...", project="villages", status="doing", tags="...")`.
2. **Branch & Commit Alignment**:
   - Create a feature branch incorporating the task identifier: `git checkout -b feat/villages-X-description main`.
   - Include the Kanzo task ID in all commit messages:
     $$\text{feat(editor): villages\#1 Implement sparse undo stack}$$
3. **Log Progress & Blockers**:
   - Post updates upon completing significant milestones or architectural changes:
     `kanzo.add_comment(id="villages#<id>", body="Implemented ... in commit <hash>.")`.
   - Provide direct status updates to the human developer in chat at key phase transitions (task pickup, implementation complete, test pass, PR opened).
   - If blocked or requesting architectural clarification from the user, add a comment documenting the blocker before pausing.
4. **Handoff & Review Transition**:
   - Once all automated checks pass locally (`yarn test`, `yarn lint`, `yarn typecheck`, `yarn build`):
     - Transition card to review: `kanzo.update_task(id="villages#<id>", status="review")`.
     - Post a concluding comment detailing modified files, verification evidence, and instructions for human review.

---

## 8. Pre-Commit / Pre-PR Checklist

Before finishing any task or opening a pull request:

1. `yarn test` passes (0 failed tests).
2. `yarn lint` passes (0 errors, 0 warnings).
3. `yarn typecheck` passes (0 type errors).
4. `yarn build` succeeds for all workspaces.
5. All newly created or modified files adhere to Prettier formatting (`yarn format`).
6. Commit messages and PR titles follow the `<type>(<scope>): <TASK-ID> Message` convention with a valid Kanzo task ID (e.g. `feat(scope): villages#1 ...`). `TASK-0` is strictly prohibited for feature PRs and bug fixes.
7. The active Kanzo task card has been transitioned to `review` with a completion comment.
8. The human developer has been notified in chat with the PR link and a concise progress summary.
9. **Visual Verification Screenshots**: For any user-facing, client, or editor feature (`apps/web`, `apps/editor`), capture multiple Playwright screenshots demonstrating distinct states of the feature (e.g. idle/initial state, active/interaction state, and toggled/result state). Commit screenshots to `assets/screenshots/` and embed them in the PR description or initial comment for visual review.
10. **Process Teardown & Resource Hygiene**: Terminate all temporary development servers, background tasks, Next.js instances, simulation processes, and headless browser instances immediately after testing or screenshot capture. Verify that no orphan background tasks (`manage_task`) or listening ports remain running before concluding your turn or handing off to review.

---

## 9. Proactive Status Reporting & Developer Visibility

To maintain tight collaboration and feedback loops with the developer:

- **Regular Progress Updates**: Agents must proactively report their progress to the human developer during active development. Never execute long, multi-step sequences or task lifecycles completely silently.
- **Reporting Triggers**:
  - **Task Start**: When picking up or moving a task to `doing` and creating the feature branch.
  - **Milestone Completion**: When core logic, schema migrations, or complex modules are finished.
  - **Test & Verification**: When running the test suite, linting, typecheck, or build, reporting whether checks passed or failed.
  - **PR Creation**: When opening a pull request, providing the PR link, modified files, and testing instructions.
- **Report Format**: Keep reports structured and concise:
  1. _Current Task & Branch_
  2. _What Was Accomplished_
  3. _Current Quality / Verification Status_
  4. _Immediate Next Step_

---

## 10. Visual Verification & Playwright PR Screenshots

Whenever a task modifies visual components, UI overlays, HUD elements, canvas rendering, or editor tooling:

1. **Capture Multiple Feature States**:
   - Never capture only a single static frame if the feature has dynamic states.
   - Capture **at least 2–3 distinct states**, for example:
     - _State A: Initial / Idle State_ (e.g., unopened chat box, empty undo stack).
     - _State B: Active / In-Use State_ (e.g., focused chat input with `/s` channel badge, brush stroke preview).
     - _State C: Result / Populated State_ (e.g., in-world 3D speech bubble above avatar, populated undo stack with active counters).
2. **Automated Capture with Playwright**:
   - Use Playwright headless Chromium to load the built app, perform user interactions (`click`, `fill`, `hover`), and call `await page.screenshot({ path: "assets/screenshots/<feature>-<state>.png" })`.
3. **Stale Bundle Prevention (Rebuild Before Capture)**:
   - Next.js `next start` serves pre-compiled artifacts from `.next/`. Any changes made to React components, styling, or packages will **not** appear if `next start` is run against an older build.
   - **Rule**: Always run `yarn --cwd apps/<app> build` (or full `yarn build`) immediately before starting the server to capture visual verification screenshots.
4. **Camera Framing & Visible 3D Differentiation**:
   - In 3D Babylon.js viewports (`apps/web`, `apps/editor`), ensure changes are actually within the camera frustum. A single chunk often fills the entire default view. When mutating adjacent chunks, placing objects, or sculpting, zoom the camera out (`await page.mouse.wheel(0, 300)`) or pan (`WASD`) so the mutations are framed clearly rather than occurring off-screen.
   - Screenshots must show **unmistakable differences**: active vs disabled button states, dynamic badge counters (`(1)`, `(2)`), status bar readouts, and physical 3D scene modifications (chunks added/removed, entities spawned, terrain displaced).
5. **Mandatory Visual Inspection**:
   - Agents must inspect captured screenshots using `read_file` to confirm that buttons, HUD overlays, and 3D mutations are genuinely rendered before committing to git.
6. **Commit & Embed in PR**:
   - Commit screenshots into `assets/screenshots/` on the feature branch.
   - Reference the screenshots in the PR description or PR comment using raw GitHub links:

     ```markdown
     ### Visual Verification

     |                                                       Initial State                                                        |                                                       Active State                                                       |                                               Populated / Triggered State                                                |
     | :------------------------------------------------------------------------------------------------------------------------: | :----------------------------------------------------------------------------------------------------------------------: | :----------------------------------------------------------------------------------------------------------------------: |
     | ![Initial](https://raw.githubusercontent.com/mrAnomalyy/villages-online/<branch>/assets/screenshots/<feature>-initial.png) | ![Active](https://raw.githubusercontent.com/mrAnomalyy/villages-online/<branch>/assets/screenshots/<feature>-active.png) | ![Result](https://raw.githubusercontent.com/mrAnomalyy/villages-online/<branch>/assets/screenshots/<feature>-result.png) |
     ```

---

## 11. Resource Hygiene & Process Teardown (Laptop Thermals & Battery Protection)

Running long-lived background servers (Next.js `next start`/`next dev`, Realm simulation tick loops, headless Chromium browsers, or watch mode runners) causes sustained high CPU load, rapid battery drain, and thermal throttling (laptop reaching 75°C+ CPU / 40°C+ battery).

Agents must adhere strictly to these operational rules:

1. **Ephemeral Execution**:
   - Treat dev servers, Next.js servers, and simulation servers as strictly temporary, single-use environments.
   - Flow: Start the server -> execute automated test/screenshot capture -> immediately stop the server using `manage_task(Action="kill")`.
2. **Never Leave Background Servers Idling**:
   - Do not leave Next.js, Realm WS server, or Gateway running while waiting for instructions, reporting progress, or concluding a task.
   - Subagents must clean up and terminate all processes they started before messaging the orchestrator or exiting.
3. **Mandatory Post-Task Teardown Verification**:
   - Before ending a turn, reporting completion, or transitioning a Kanzo task card to `review`:
     - Run `manage_task(Action="list")` to ensure all task runners are terminated.
     - Check listening ports (e.g. `lsof -i :3000 -i :3001 -i :4000 -i :4321`) to ensure no orphan Node or Chromium processes remain bound to local ports.
4. **No Watch Flags in Background**:
   - Never run `vitest --watch`, `jest --watch`, `next dev` without explicit need, or any file watcher in background tasks. Always use single-run commands (`vitest run`, `yarn build`, `yarn test`).
