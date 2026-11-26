# Parking Inventory — shared infrastructure handoff

Source: original Parking Allocation `parking-infrastructure.zip` supplied in this conversation. The shared helper and network scripts are copied unchanged. The Inventory ECS script and generator are adaptations, not a verified deployment on Ahmed’s laptop. The Allocation references are for reading only, not execution.

## Copy into the Inventory repository

Copy the contents of this package into the repository root after comparing existing files. Do not overwrite existing work blindly. No actual secrets, `.env`, AWS credentials or generated runtime files are included. Ensure `.local/` and `.env` are ignored by Git. Do not place any passwords/tokens in task settings, even under innocuous variable names.

## Prerequisites

- Git Bash, Node.js, AWS CLI, local `floci` AWS CLI profile, healthy Floci at localhost:4566 (same version as the team, 2.5.0).
- Inventory app listens on port 3002, has a `/health` route and `/api/inventory/*` routes. Actual host workers use localhost:4566 for DynamoDB.
- Create your own DynamoDB tables, least-privilege IAM task/execution roles (`parking-inventory-task`, `parking-inventory-execution`), log group `/aws/ecs/parking-inventory`, and any Secrets Manager entries under `parking/inventory/`. Both roles trust ecs-tasks.amazonaws.com; task role has only needed Inventory table permissions; execution role has needed secret and log permissions. Do not use Allocation roles or tables.
- Cognito is being implemented by the team lead. Do not create a competing shared user pool; coordinate token validation later.

## Local development commands (Git Bash, repository root)

1. `source infra/services/_lib.sh`
2. `awsl sts get-caller-identity`
3. `bash infra/services/09-elbv2.sh` — only needed in a separate local Floci environment where the shared network is not already configured. In the final shared environment, reuse the existing VPC, ALB, subnets, groups and target groups.
4. `cp -n infra/inventory-task-settings.example.json infra/inventory-task-settings.json`
5. Edit the settings JSON to match your actual application. `environment` is a mapping of non-sensitive variable names to string values (e.g. your real table environment variable names). `secretNames` maps environment variable names to existing Secrets Manager names (e.g. `INVENTORY_TOKEN` to `parking/inventory/internal` ONLY if those are your real names). The supplied empty maps are placeholders, not a complete app configuration. Do not put values of secrets in this file. Review the role names and log group with your implementation. Adjust the template if your existing names differ.
6. `bash infra/services/10-inventory-ecs.sh --reviewed` — generates `.local/runtime/inventory-task.json`, registers the Inventory task, creates or updates the ECS service, and configures scaling. This is Lab 8 recorded-resource mode only; do not build or start a backend Docker image. For an existing service, check that it already has the intended target group and networking; the update path only updates task definition and desired count.
7. Verify:
   - `awsl ecs describe-services --cluster parking-cluster --services parking-inventory --output json`
   - `awsl ecs describe-task-definition --task-definition parking-inventory --output json`
   - `awsl application-autoscaling describe-scalable-targets --service-namespace ecs --resource-ids service/parking-cluster/parking-inventory --output json`
   - `awsl application-autoscaling describe-scaling-policies --service-namespace ecs --resource-id service/parking-cluster/parking-inventory --output json`

Expected: active Inventory service, desired 1, recorded running count may be 0, target group parking-inventory-tg, CPU 256, memory 512, FARGATE, min 1/max 4, target CPU 50%. If scaling warnings appear, investigate before calling the feature verified.

## Shared naming contract

VPC parking-vpc (10.0.0.0/16); subnets 10.0.1.0/24 us-east-1a and 10.0.2.0/24 us-east-1b; parking-alb-sg; parking-backend-sg; parking-alb; parking-cluster. Target groups: parking-allocation-tg port 3001 priority 40 `/api/allocation/*`; parking-inventory-tg port 3002 priority 50 `/api/inventory/*`; parking-incidents-tg port 3003 priority 60 `/api/incidents/*`. Health check `/health`. Local Inventory worker ports 3002, 3012, 3022; shared local proxy port 8080.

The shared ALB and Fargate configuration is recorded on Floci; actual traffic distribution, logs, scaling and failover need separate local worker testing. No actual Fargate execution, IAM enforcement, or production TLS is claimed by these files. HTTP and the placeholder image are for the selected lab mode only. Do not run on real AWS.

## Integration

Coordinate Inventory API contract with Allocation: GET `/api/inventory/spots?zone_id=zone_1&spot_type=standard`, backend-only Bearer token, response `{ "data": [{ "spot_id":"A1", "zone_id":"zone_1", "spot_type":"standard", "active":true }] }`. Agree on exact token handling and common Cognito configuration with the team. Do not copy Allocation-specific policies or secrets. Inventory owns its own tables; Allocation manages reservations.
