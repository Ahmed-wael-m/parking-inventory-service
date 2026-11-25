$ErrorActionPreference = 'Stop'
node --version
npm.cmd --version
git --version
aws --version
docker version --format '{{.Server.Version}}'
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}'
# Check the running container name from the output before using docker inspect.
aws --profile floci --endpoint-url http://localhost:4566 --region us-east-1 dynamodb list-tables
if ($LASTEXITCODE -ne 0) { throw 'Floci DynamoDB check failed; do not continue.' }
