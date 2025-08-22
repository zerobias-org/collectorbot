#!/usr/bin/env bash

set -e

if [ "$2" = "--dry-run" ]; then
  echo "--- This was only a dry-run ---"
fi;

BASEDIR=$(pwd)
FULL_PACKAGE_VERSION=$1

PACKAGE="@$(echo "$FULL_PACKAGE_VERSION" | jq -r -R -s -c 'split("@")[1] | split("\n")[0]')"
VERSION=$(echo "$FULL_PACKAGE_VERSION" | jq -r -R -s -c 'split("@")[2] | split("\n")[0]')

LOCATION=$(npx lerna list --json | jq --arg PACKAGE $PACKAGE -r '.[] | select(.name == $PACKAGE).location')

echo "--- Creating image for $FULL_PACKAGE_VERSION"

cd utils/container-generator
GENERATOR_DIR=$(pwd)

echo "--- Installing dependencies"
npm ci || npm i
cd $BASEDIR

tmpdir=$(mktemp -d)
cp .npmrc $tmpdir

echo "--- Changing directory to $tmpdir"
cd $tmpdir

if [ "$2" = "--dry-run" ]; then
  cp -R $LOCATION/* $tmpdir
  echo "--- Building PR collector"
  npm ci
  npm run build
else
  npm pack "$FULL_PACKAGE_VERSION" --loglevel warn
  tar xf *.tgz --strip-components=1
fi;

name=$(cat package.json | jq -r '.name | split("/")[1]')
version=$(cat package.json | jq -r '.version')
deprecated=$(cat package.json | jq -rc '.auditmation.deprecated')

if [ "${deprecated}" == "true" ]; then
	echo "--- Skipping deprecated module $name"
	exit 0;
fi

set +e

echo "--- Downloaded $name@$version"
IMAGE_META=$(aws ecr describe-images --repository-name=auditlogic-$name --image-ids=imageTag=$version)
if [[ $? == 0 ]]; then
  IMAGE_TAGS="$( echo ${IMAGE_META} | jq '.imageDetails[0].imageTags[0]' -r )"
  echo "$name:$version found"
  # exit 0
else
  echo "$name:$version not found"
fi

set -e

echo "--- Building docker module for $FULL_PACKAGE_VERSION in $(pwd)"
cp $GENERATOR_DIR/templates/Dockerfile $tmpdir
cp $BASEDIR/package/avigilon/alta/access/tsconfig.json $tmpdir
if [ -e "$LOCATION/tsconfig.json" ]; then
  cp $LOCATION/tsconfig.json $tmpdir || 'No specific tsconfig found'
fi
mkdir generated || echo "--- generated dir already exists"
npm ci
if [ "$2" = "--dry-run" ]; then
  GENERATOR_DIR=$GENERATOR_DIR name=$name location=$tmpdir node $GENERATOR_DIR/src/index.js --dry-run
else
  GENERATOR_DIR=$GENERATOR_DIR name=$name location=$tmpdir node $GENERATOR_DIR/src/index.js
fi
npx tsc

echo "--- Pruning dependencies"
npm prune --omit=dev

if [ "$2" = "--dry-run" ]; then
  echo "Building local image for testing"
  docker buildx build --platform linux/amd64 -t 961260934100.dkr.ecr.us-east-1.amazonaws.com/auditlogic-$name:$version -o type=docker .
else
  echo "Building image for ecr"
  aws ecr create-repository \
	  --repository-name auditlogic-$name \
	  --region us-east-1 || echo "Repository already created"

  aws ecr set-repository-policy --repository-name auditlogic-$name \
	  --policy-text '{ "Version": "2012-10-17", "Statement": [ { "Sid": "ReadonlyAccess", "Effect": "Allow", "Principal": { "AWS": "*" }, "Action": [ "ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:DescribeImageScanFindings", "ecr:DescribeImages", "ecr:DescribeRepositories", "ecr:GetAuthorizationToken", "ecr:GetDownloadUrlForLayer", "ecr:GetRepositoryPolicy", "ecr:ListImages" ], "Condition": { "StringLike": { "aws:PrincipalOrgID": "o-dppyp34ws8" } } } ] }'

  docker buildx build --platform linux/amd64,linux/arm64 -t 961260934100.dkr.ecr.us-east-1.amazonaws.com/auditlogic-$name:$version --push .

  echo "Building image for ghcr"
  docker buildx build --platform linux/amd64,linux/arm64 -t ghcr.io/auditlogic/auditlogic-$name:$version --push .
fi

echo "--- Changing back to $BASEDIR"
cd $BASEDIR
