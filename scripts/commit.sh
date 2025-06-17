#! /bin/sh
git add .
git commit -m "chore(release): bump version"
npx lerna list --since --ndjson | jq -r '(.name) + "@" + (.version)' | xargs -L1 git tag -a -m "chore(release): bump version"
git push origin
git push --tags
