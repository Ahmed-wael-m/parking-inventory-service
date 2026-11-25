
#!/usr/bin/env bash
set -euo pipefail

export AWS_PAGER=""
export MSYS_NO_PATHCONV=1

awsl() {
    aws --profile floci \
        --endpoint-url http://localhost:4566 \
        --region us-east-1 "$@"
}

LOG_GROUP="/aws/ecs/parking-inventory"
LOG_STREAM="app-audit-stream"

# Check whether the log group exists
EXISTING_GROUP=$(awsl logs describe-log-groups \
    --log-group-name-prefix "$LOG_GROUP" \
    --query "logGroups[?logGroupName=='$LOG_GROUP'].logGroupName | [0]" \
    --output text)

if [ "$EXISTING_GROUP" != "$LOG_GROUP" ]; then
    awsl logs create-log-group \
        --log-group-name "$LOG_GROUP"

    echo "Inventory log group created."
else
    echo "Inventory log group already exists."
fi

# Check whether the log stream exists
EXISTING_STREAM=$(awsl logs describe-log-streams \
    --log-group-name "$LOG_GROUP" \
    --log-stream-name-prefix "$LOG_STREAM" \
    --query "logStreams[?logStreamName=='$LOG_STREAM'].logStreamName | [0]" \
    --output text)

if [ "$EXISTING_STREAM" != "$LOG_STREAM" ]; then
    awsl logs create-log-stream \
        --log-group-name "$LOG_GROUP" \
        --log-stream-name "$LOG_STREAM"

    echo "Inventory log stream created."
else
    echo "Inventory log stream already exists."
fi

echo "Inventory CloudWatch configured successfully."

ACCOUNT_ID=$(awsl sts get-caller-identity \
    --query Account --output text)

LOG_ARN="arn:aws:logs:us-east-1:${ACCOUNT_ID}:log-group:${LOG_GROUP}"

# Allow Inventory to write application logs
awsl iam put-role-policy \
    --role-name parking-inventory-task-role \
    --policy-name inventory-cloudwatch-access \
    --policy-document "{
        \"Version\": \"2012-10-17\",
        \"Statement\": [{
            \"Effect\": \"Allow\",
            \"Action\": \"logs:PutLogEvents\",
            \"Resource\": \"$LOG_ARN:log-stream:$LOG_STREAM\"
        }]
    }"

# Configure ECS execution role logging permissions
awsl iam put-role-policy \
    --role-name parking-inventory-execution-role \
    --policy-name inventory-execution-logs \
    --policy-document "{
        \"Version\": \"2012-10-17\",
        \"Statement\": [{
            \"Effect\": \"Allow\",
            \"Action\": [
                \"logs:CreateLogStream\",
                \"logs:PutLogEvents\"
            ],
            \"Resource\": \"$LOG_ARN:log-stream:*\"
        }]
    }"

echo "Inventory CloudWatch IAM permissions configured."
