#! /bin/sh
set -e
set -x

NPM_TOKEN=$READ_TOKEN npm i
NPM_TOKEN=$READ_TOKEN npm shrinkwrap

NAME=$(jq -r '.name' package.json)
VERSION=$(jq -r '.version' package.json)

LATEST=$(npm view $NAME dist-tags.latest) || echo ""

if [ "$VERSION" != "$LATEST" ]; then
  NPM_TOKEN=$READ_TOKEN npm i
  NPM_TOKEN=$READ_TOKEN npm publish
fi
