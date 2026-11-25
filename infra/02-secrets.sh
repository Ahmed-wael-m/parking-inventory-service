
#!/usr/bin/env bash
set -euo pipefail

export AWS_PAGER=""
export MSYS_NO_PATHCONV=1

awsl() {
    aws --profile floci \
        --endpoint-url http://localhost:4566 \
        --region us-east-1 "$@"
}

# Create and verify the secret
node scripts/setup-secret.js

# Retrieve the secret ARN
SECRET_ARN=$(awsl secretsmanager describe-secret \
    --secret-id parking-inventory/config \
    --query ARN --output text)

# Grant the application permission to retrieve its secret
awsl iam put-role-policy \
    --role-name parking-inventory-task-role \
    --policy-name inventory-secret-access \
    --policy-document "{
        \"Version\": \"2012-10-17\",
        \"Statement\": [{
            \"Effect\": \"Allow\",
            \"Action\": \"secretsmanager:GetSecretValue\",
            \"Resource\": \"$SECRET_ARN\"
        }]
    }"

echo "Inventory Secrets Manager configured successfully."
