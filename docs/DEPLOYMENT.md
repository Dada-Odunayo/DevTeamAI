# DevTeam AI - Alibaba Cloud Deployment

## Overview

DevTeam AI is a multi-agent software engineering platform deployed on **Alibaba Cloud Elastic Compute Service (ECS)** and powered by **QwenCloud's OpenAI-compatible API**.

The application orchestrates multiple specialized AI agents—including Product Manager, Solution Architect, Backend Engineer, Frontend Engineer, QA Engineer, CTO Reviewer, Negotiator, Revision Coordinator, Code Generator, and Code Reviewer—to transform a simple product idea into production-ready software plans and starter code.

---

# Alibaba Cloud Services Used

## 1. Alibaba Cloud Elastic Compute Service (ECS)

The entire application is deployed on an Alibaba Cloud ECS instance running **Alibaba Linux**.

ECS hosts:

- FastAPI Backend
- Next.js Frontend
- Docker Compose
- Nginx Reverse Proxy
- SQLite Database

---

## 2. QwenCloud (DashScope)

DevTeam AI uses **QwenCloud's OpenAI-compatible Chat Completions API** as the reasoning engine behind every AI agent.

The backend communicates directly with QwenCloud to power:

- Product Manager Agent
- Solution Architect Agent
- Backend Engineer Agent
- Frontend Engineer Agent
- QA Engineer Agent
- CTO Reviewer Agent
- Negotiator Agent
- Revision Coordinator Agent
- Code Generator Agent
- Code Reviewer Agent

The AI layer is responsible for:

- Product Requirement Generation
- Architecture Design
- API Planning
- Database Design
- QA Planning
- Technical Reviews
- Conflict Resolution
- Revision Summaries
- Starter Code Generation
- Code Review

---

# Deployment Architecture

```
                    Internet
                         │
                         ▼
              Alibaba Cloud ECS
                  (Alibaba Linux)
                         │
                    Nginx Reverse Proxy
                  ┌──────────┴──────────┐
                  ▼                     ▼
          Next.js Frontend      FastAPI Backend
                                        │
                                        ▼
                             Workflow Orchestrator
                                        │
      ┌───────────────────────────────────────────────────────┐
      │ Product Manager │ Architect │ Backend │ Frontend      │
      │ QA │ CTO │ Negotiator │ Revision │ Code Generator     │
      │ Code Reviewer                                    │
      └───────────────────────────────────────────────────────┘
                                        │
                                        ▼
                           QwenCloud Chat API
```

---

# Technology Stack

## Frontend

- Next.js
- React
- TypeScript
- Tailwind CSS
- Server-Sent Events (SSE)

## Backend

- FastAPI
- Python
- SQLAlchemy
- SQLite
- Pydantic
- HTTPX

## AI

- QwenCloud (DashScope)
- OpenAI-Compatible Chat API

## Infrastructure

- Alibaba Cloud ECS
- Alibaba Linux
- Docker Compose
- Nginx

---

# Deployment

The application is containerized with Docker Compose.

```bash
docker compose up -d --build
```

Services:

| Service | Technology | Internal Port |
|----------|------------|--------------:|
| Frontend | Next.js | 3000 |
| Backend | FastAPI | 8000 |
| Reverse Proxy | Nginx | 80 / 443 |

Nginx routes frontend requests and proxies backend API traffic securely.

---

# Relevant Deployment Files

The following files demonstrate the deployment and Alibaba Cloud integration:

- `docker-compose.yml` — Docker service orchestration
- `frontend/Dockerfile` — Frontend container
- `backend/Dockerfile` — Backend container
- `nginx/default.conf` — Reverse proxy configuration
- `backend/app/services/qwen_service.py` *(or equivalent)* — QwenCloud API integration
- `backend/app/main.py` — FastAPI application entry point

---

# QwenCloud Integration

The backend communicates with QwenCloud using the OpenAI-compatible API.

Example initialization:

```python
from openai import OpenAI

client = OpenAI(
    api_key=os.getenv("QWEN_API_KEY"),
    base_url="https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
)
```

Each workflow stage invokes QwenCloud with role-specific prompts to simulate collaboration between specialized software engineering agents.

---

# Public Deployment

The application is publicly hosted on Alibaba Cloud ECS.

**Frontend**

```
https://<your-domain>
```

or

```
http://<ECS_PUBLIC_IP>
```

**Backend API**

```
https://<your-domain>/api
```

**Swagger Documentation**

```
https://<your-domain>/api/docs
```

---

# Proof of Alibaba Cloud Usage

This project demonstrates Alibaba Cloud usage in two ways:

1. **Infrastructure**
   - Deployed on Alibaba Cloud Elastic Compute Service (ECS) running Alibaba Linux.

2. **Artificial Intelligence**
   - Uses QwenCloud (DashScope) as the AI reasoning engine through its OpenAI-compatible API to power all specialized software engineering agents.

Together, Alibaba Cloud ECS and QwenCloud provide both the hosting infrastructure and AI capabilities that enable DevTeam AI's multi-agent software development workflow.