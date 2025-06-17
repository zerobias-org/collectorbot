#!/bin/bash
set +x
PRODUCT_NAMES=$(npx lerna exec -- 'yq e .name package.json')
PRODUCT_ARR=($PRODUCT_NAMES)
PRODUCT_VERSIONS=$(npx lerna exec -- 'yq e .version package.json')
PRODUCT_VERSION_ARR=($PRODUCT_VERSIONS)
DEPS="\"dependencies\": {\n"
LENGTH=${#PRODUCT_ARR[@]};
echo $LENGTH
for ((i=0;i < $LENGTH; i++)); do
  PRODUCT_NAME=${PRODUCT_ARR[$i]}
  PRODUCT_VERSION=${PRODUCT_VERSION_ARR[$i]}
  echo "Working with standard $PRODUCT_NAME -- $PRODUCT_VERSION"
  DEPS="$DEPS\"$PRODUCT_NAME\": \"^$PRODUCT_VERSION\"\n"
done

DEPS="$DEPS}"
echo -e $DEPS;
