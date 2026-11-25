
#!/usr/bin/env bash
set -euo pipefail

# Local Floci configuration
export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test
export AWS_DEFAULT_REGION=us-east-1
export AWS_PAGER=""
export MSYS_NO_PATHCONV=1
unset AWS_SESSION_TOKEN

awsl() {
    aws --endpoint-url http://localhost:4566 --region us-east-1 "$@"
}

ACCOUNT_ID=$(awsl sts get-caller-identity --query Account --output text)

# Create an IAM role if it does not exist
create_role() {
    if awsl iam get-role --role-name "$1" >/dev/null 2>&1; then
        echo "$1 already exists"
    else
        awsl iam create-role \
            --role-name "$1" \
            --assume-role-policy-document file://infra/ecs-trust.json \
            --query Role.RoleName --output text
    fi
}

# Create the two Inventory roles
create_role parking-inventory-task-role
create_role parking-inventory-execution-role

# Reuse the existing policy template for our local tables
POLICY=$(sed \
    -e "s/ACCOUNT_ID/$ACCOUNT_ID/g" \
    -e 's/table\/ParkingZones"/table\/ParkingZones_test_local"/g' \
    -e 's/table\/ParkingSpots"/table\/ParkingSpots_test_local"/g' \
    infra/task-policy.example.json)

# Apply database permissions to the task role
awsl iam put-role-policy \
    --role-name parking-inventory-task-role \
    --policy-name inventory-dynamodb-access \
    --policy-document "$POLICY"

echo "Inventory IAM roles configured successfully."
