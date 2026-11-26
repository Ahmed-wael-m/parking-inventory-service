#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_lib.sh"

# Inventory only. Lab 8 recorded-resource mode; no backend image is built.
VPC=$(awsl ec2 describe-vpcs --filters Name=tag:Name,Values=parking-vpc --query 'Vpcs[0].VpcId' --output text)
A=$(awsl ec2 describe-subnets --filters "Name=vpc-id,Values=$VPC" Name=cidr-block,Values=10.0.1.0/24 --query 'Subnets[0].SubnetId' --output text)
B=$(awsl ec2 describe-subnets --filters "Name=vpc-id,Values=$VPC" Name=cidr-block,Values=10.0.2.0/24 --query 'Subnets[0].SubnetId' --output text)
SG=$(awsl ec2 describe-security-groups --filters "Name=vpc-id,Values=$VPC" Name=group-name,Values=parking-backend-sg --query 'SecurityGroups[0].GroupId' --output text)
TG=$(awsl elbv2 describe-target-groups --names parking-inventory-tg --query 'TargetGroups[0].TargetGroupArn' --output text)
for id in "$VPC" "$A" "$B" "$SG" "$TG"; do exists "$id" || { echo 'Run 09-elbv2.sh first' >&2; exit 1; }; done
CLUSTER=$(awsl ecs describe-clusters --clusters parking-cluster --query 'clusters[?status==`ACTIVE`].clusterName | [0]' --output text)
if ! exists "$CLUSTER"; then
  echo "Shared parking-cluster is missing." >&2
  echo "Configure the shared infrastructure first." >&2
  exit 1
fi
# Review the settings file against the actual Inventory backend before provisioning.
[[ "${1:-}" == --reviewed ]] || { echo 'Read INVENTORY-HANDOFF.md, review infra/inventory-task-settings.json, then run with --reviewed.' >&2; exit 1; }
[[ -f infra/inventory-task-settings.json ]] || { echo 'Copy and edit infra/inventory-task-settings.example.json first.' >&2; exit 1; }
mkdir -p .local/runtime
TASK_ROLE=$(awsl iam get-role --role-name parking-inventory-task-role --query Role.Arn --output text)
EXEC_ROLE=$(awsl iam get-role --role-name parking-inventory-execution-role --query Role.Arn --output text)
LOG_GROUP=$(awsl logs describe-log-groups --log-group-name-prefix /aws/ecs/parking-inventory --query 'logGroups[?logGroupName==`/aws/ecs/parking-inventory`].logGroupName | [0]' --output text)
for id in "$TASK_ROLE" "$EXEC_ROLE" "$LOG_GROUP"; do exists "$id" || { echo 'Configure Inventory IAM roles and CloudWatch log group first.' >&2; exit 1; }; done
# Retrieve only secret names and ARNs, never values.
# Verify the existing Inventory secret without reading its values.
SECRET_ARN=$(awsl secretsmanager describe-secret \
    --secret-id parking-inventory/config \
    --query ARN --output text)

if ! exists "$SECRET_ARN"; then
    echo "Inventory secret is missing." >&2
    exit 1
fi

echo "Existing Inventory secret verified."
node infra/runtime/inventory-task.cjs "$TASK_ROLE" "$EXEC_ROLE"
TASK=$(awsl ecs register-task-definition --cli-input-json "$(cli_file .local/runtime/inventory-task.json)" --query taskDefinition.taskDefinitionArn --output text)
OLD=$(awsl ecs describe-services --cluster parking-cluster --services parking-inventory --query 'services[?status==`ACTIVE`].serviceName | [0]' --output text)
# In the Lab 8 recorded-resource mode, desired count mirrors local workers.
# If native execution is enabled, do not start local replicas in parallel.
if exists "$OLD"; then
  awsl ecs update-service --cluster parking-cluster --service parking-inventory --task-definition "$TASK" --desired-count 1 >/dev/null
else
  awsl ecs create-service --cluster parking-cluster --service-name parking-inventory --task-definition "$TASK" --desired-count 1 --launch-type FARGATE --network-configuration "awsvpcConfiguration={subnets=[$A,$B],securityGroups=[$SG],assignPublicIp=DISABLED}" --load-balancers "targetGroupArn=$TG,containerName=inventory,containerPort=3002" >/dev/null
fi
awsl application-autoscaling register-scalable-target --service-namespace ecs --resource-id service/parking-cluster/parking-inventory --scalable-dimension ecs:service:DesiredCount --min-capacity 1 --max-capacity 4 || warn 'Auto Scaling target not recorded; manual local scaling remains possible.'
awsl application-autoscaling put-scaling-policy --service-namespace ecs --resource-id service/parking-cluster/parking-inventory --scalable-dimension ecs:service:DesiredCount --policy-name parking-inventory-cpu --policy-type TargetTrackingScaling --target-tracking-scaling-policy-configuration '{"TargetValue":50.0,"PredefinedMetricSpecification":{"PredefinedMetricType":"ECSServiceAverageCPUUtilization"}}' >/dev/null || warn 'Auto Scaling policy not recorded.'
awsl ecs describe-services --cluster parking-cluster --services parking-inventory --query 'services[].{Name:serviceName,Desired:desiredCount,Running:runningCount}' --output table
