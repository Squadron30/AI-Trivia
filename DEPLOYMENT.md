# Deploying AI Trivia on Azure

Two supported paths. **Option A (App Service)** is the simplest; **Option B (Container Apps)** gives finer autoscaling.

## Prerequisites
- Azure subscription + `az` CLI (`az login`)
- The `ai-trivia` folder (this project)

---
## Option A — Azure App Service + Azure Cache for Redis (recommended)

### 1. Create a resource group
```bash
az group create -n ai-trivia-rg -l eastus
```

### 2. Provision infra with Bicep (App Service plan, web app, Redis)
```bash
az deployment group create \
  -g ai-trivia-rg \
  -f azure/main.bicep \
  -p appName=ai-trivia instanceCount=2 planSku=P1v3
```
The deployment enables **WebSockets**, **session affinity (ARR)**, and wires `REDIS_URL` automatically. Note the `siteUrl` / `presenterUrl` outputs.

### 3. Deploy the code
```bash
zip -r app.zip . -x "node_modules/*" "data/*" ".git/*"
az webapp deploy -g ai-trivia-rg -n <siteName-from-output> --src-path app.zip --type zip
```
(Kudu runs `npm install` because `SCM_DO_BUILD_DURING_DEPLOYMENT=true`.)

### 4. Go live
- Presenter (share this screen): `https://<site>/presenter.html`
- Players join at: `https://<site>/`

---
## Option B — Azure Container Apps (container image)

```bash
# Build & push image to Azure Container Registry
az acr create -g ai-trivia-rg -n aitriviaacr --sku Basic
az acr build -r aitriviaacr -t ai-trivia:latest .

# Redis for scale-out
az redis create -g ai-trivia-rg -n ai-trivia-redis --sku Basic --vm-size c1

# Container Apps environment + app (session affinity ON is required for Socket.IO)
az containerapp env create -g ai-trivia-rg -n ai-trivia-env -l eastus
az containerapp create -g ai-trivia-rg -n ai-trivia \
  --environment ai-trivia-env \
  --image aitriviaacr.azurecr.io/ai-trivia:latest \
  --target-port 3000 --ingress external \
  --min-replicas 1 --max-replicas 5 \
  --env-vars REDIS_URL="rediss://:<key>@<host>:6380"
# Then enable sticky sessions:
az containerapp ingress sticky-sessions set -g ai-trivia-rg -n ai-trivia --affinity sticky
```

---
## Persistence for production (leaderboards that survive restarts)
The default file store is fine for a single instance/dev. For production, back it with **Azure Cosmos DB**:
1. `az cosmosdb create -g ai-trivia-rg -n ai-trivia-cosmos`
2. Reimplement the methods in `server/store.js` against Cosmos (same interface — see ARCHITECTURE.md data model).
3. Add the connection string as an app setting.

## Scaling notes for 200+ users
- P1v3 single instance handles a few hundred concurrent sockets. Run **2+ instances** for resilience.
- Multiple instances **require** both: (a) `REDIS_URL` set (adapter), and (b) session affinity ON (already configured).
- Watch the App Service / Container Apps metrics: CPU, memory, and websocket connection count.

## Cost (rough, East US, always-on)
| Resource | SKU | ~USD/month |
|---|---|---|
| App Service Plan | P1v3 (x1) | ~$115 |
| Azure Cache for Redis | Basic C1 | ~$40 |
| Cosmos DB (optional) | Serverless | pay-per-use, low for this workload |

Scale the plan down to B1/B2 for smaller events, or stop it between sessions to save cost.
