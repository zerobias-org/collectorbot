# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

# 1.0.0 (2026-08-04)

### Features

* initial release — Azure Resource Graph collectorbot
* populates `AzureResourceGraph`, `AzureResourceGraphResource` and
  `AzureResourceGraphResourceType` from the Resource Graph `Resources` table
  (api-version 2024-04-01, `$skipToken` paging, tenant-wide by default)
* populates the suite-schema container classes `AzureSubscription` and
  `AzureResourceGroup` from the `ResourceContainers` table; management group
  rows are skipped (no schema class yet)
* optional `subscriptions[]` scoping parameter and `skipResourceTypes[]`
  filter
