# DevTeam AI

DevTeam AI is a Qwen-powered multi-agent software delivery team for the Qwen Cloud Hackathon Agent Society track.

A user enters a product idea. DevTeam AI runs a team of specialized agents:

- Orchestrator Agent
- Product Manager Agent
- Solution Architect Agent
- Backend Agent
- Frontend Agent
- QA Agent
- CTO Reviewer Agent
- Negotiator Agent
- Revision Coordinator Agent
- Code Generator Agent
- Code Reviewer Agent

The system produces practical delivery artifacts:

- Product Requirements Document
- Architecture plan with Mermaid diagram
- API specification
- Database schema
- Frontend/mobile app plan
- QA test plan
- CTO review report
- Negotiation decision records
- Revision summary
- Baseline comparison against a single-agent output
- Optional generated starter code after final approval

## Why this fits Agent Society

DevTeam AI is not just a prompt chain. It demonstrates:

- Task decomposition across distinct agents
- Role-based agent collaboration
- Human approval gates between stages
- Visible agent dialogue, challenges, defenses, and decisions
- CTO review and conflict detection
- Negotiation and resolution for open conflicts
- Revision coordination after CTO or negotiation findings
- Memory lookup from previous generated projects
- Baseline comparison against a single-agent response with explainable metrics

## Tech stack

Backend:

- Python 3.12+
- FastAPI
- httpx
- SQLite memory store
- Qwen Cloud OpenAI-compatible chat API

Frontend:

- Next.js
- TypeScript
- Tailwind CSS
- Server-Sent Events for live stage progress

## Requirements

Use Python 3.12 or 3.13 for the backend. Python 3.14 may still cause package compatibility issues depending on your environment.

## Backend setup

```bash
cd backend
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip setuptools wheel
pip install -r requirements.txt
cp .env.example .env
```

Edit `backend/.env`:

```env
QWEN_API_KEY=your_qwen_or_dashscope_api_key
QWEN_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1
QWEN_MODEL=qwen-plus
APP_ENV=local
DATABASE_PATH=data/devteam.sqlite
```

Run:

```bash
uvicorn app.main:app --reload --port 8000
```

Open:

```text
http://127.0.0.1:8000/docs
```

## Frontend setup

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

Edit `frontend/.env.local` if your backend is not running on the default port:

```env
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000
```

Open:

```text
http://localhost:3000
```

## Test request

```bash
curl -X POST http://127.0.0.1:8000/projects \
  -H "Content-Type: application/json" \
  -d '{
    "idea": "Build a logistics POS system for delivery companies that supports wallet payments, cash collections, dispatch rider assignment, transaction history, settlement tracking, and offline mode.",
    "target_users": "SME logistics companies, dispatch riders, cashiers, branch managers, finance teams",
    "platform": "Android mobile app and web dashboard",
    "constraints": ["Must work offline", "Must support low-end Android devices", "Must generate audit logs"],
    "preferred_frontend_stack": "Auto-select best stack"
  }'
```

Run one staged agent step:

```bash
curl -X POST http://127.0.0.1:8000/projects/{project_id}/stages/decomposition/run \
  -H "Content-Type: application/json" \
  -d '{}'
```

Or stream progress events while a stage runs:

```bash
curl -N -X POST http://127.0.0.1:8000/projects/{project_id}/stages/decomposition/run-stream \
  -H "Content-Type: application/json" \
  -d '{}'
```

Approve it and proceed through the gated workflow:

```bash
curl -X POST http://127.0.0.1:8000/projects/{project_id}/stages/decomposition/approve
```

The legacy quick-run endpoint remains available at `POST /projects/run`.

## Project workflow endpoints

- `POST /projects` creates a staged project.
- `GET /projects` lists staged projects and legacy quick-run projects.
- `GET /projects/{project_id}` returns either a staged project or legacy quick-run project.
- `GET /projects/{project_id}/state` returns staged project state.
- `POST /projects/{project_id}/stages/{stage_name}/run` runs one gated stage.
- `POST /projects/{project_id}/stages/{stage_name}/run-stream` runs one gated stage with Server-Sent Events.
- `POST /projects/{project_id}/stages/{stage_name}/approve` approves a completed stage.
- `POST /projects/{project_id}/stages/{stage_name}/revise` reruns a stage with human feedback.
- `POST /projects/{project_id}/stages/{stage_name}/regenerate` reruns a stage without new feedback.
- `GET /projects/{project_id}/dialogue` lists the agent dialogue timeline.
- `GET /projects/{project_id}/conflicts` lists detected conflicts.
- `POST /projects/{project_id}/conflicts/{conflict_id}/resolve` resolves or accepts a conflict.
- `POST /projects/{project_id}/baseline/run` runs the single-agent baseline.
- `GET /projects/{project_id}/comparison` returns the baseline comparison.
- `POST /projects/{project_id}/generate-code` generates starter code after approvals.
- `POST /projects/{project_id}/review-code` reviews generated starter code.

## Export generated artifacts

After running a project, call:

```bash
curl -L http://127.0.0.1:8000/projects/{project_id}/export.zip -o devteam-artifacts.zip
```

`GET /projects/{project_id}/export` is also available as an alias.

## Local Docker

```bash
docker compose up --build
```

## Hackathon demo flow

1. Enter: `Build a logistics POS system`.
2. Show Orchestrator Agent decomposing tasks and assigning roles.
3. Approve PRD and architecture stages to unlock Backend and Frontend plans.
4. Show Agent Dialogue with proposals, challenges, and approvals.
5. Show CTO Agent detecting conflicts such as offline sync or hardware stack risk.
6. Request a revision or regenerate a stage to show the human approval loop.
7. Resolve an open conflict with the Negotiator Agent.
8. Show Revision Coordinator summarizing accepted changes.
9. Run baseline comparison and show score improvement.
10. Approve the final plan, generate starter code, run code review, and export the artifacts ZIP.
