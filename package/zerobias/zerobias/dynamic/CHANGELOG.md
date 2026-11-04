# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## 1.1.0 (2026-11-03)

1.0.15 was never published; its changes ship in this release. See USERGUIDE.md for details.

### Features

* **dynamic:** collect the files attached to a pipeline (`params.files`) as one `File` snapshot batch in group `pipeline-files:<pipelineId>`, apart from the data mappings' group. Only the job launched with `files` collects them, from the pipeline's current list, and preview runs skip them. Hub files are copied from their target again first, waiting up to 30 s per file and 120 s per run for the new version. Deletes are off for a run in which any listed file can't be resolved, so a fileservice hiccup never deletes the object of a file still attached.
* **dynamic:** read the pipeline's file list again right before creating the File batch, so an add or remove made during the run is not undone: files removed meanwhile are left out, and files added meanwhile are collected too, by the same deadline, so the batch, which supersedes the platform's own snapshot of the add, carries their records. A failed read turns deletes off.
* **dynamic:** give collecting files a 10-minute deadline. Files not collected by then count as unresolved, which turns deletes off, and each fileservice call is cut off at the deadline.
* **dynamic:** retry fileservice calls that get no answer, time out or are answered 429, 502, 503 or 504, up to four attempts, 0.5 s, 1 s and 2 s apart. A copy answered 409 (Hub refused it) or 404 (the object is gone from the target) is not retried; the bot warns and records the version fileservice already has.
* **dynamic:** reach fileservice at `FILE_SERVICE_API` when it is set, otherwise at the hub URL with `/hub` replaced by `/file-service`.

### Bug Fixes

* **dynamic:** fail data mappings closed. A source fetch error now logs an error on the batch, which fails the batch and the job, instead of importing a partial list with deletes on and deleting every object it left out. When that error log can't be written, the batch is left open, which fails the job too.
* **dynamic:** page collections up to 10,000 pages, about 1,000,000 elements, rather than the library's default of 1000 pages, about 100,100 elements, which with fail-closed mappings would fail every run of a larger collection. A source that keeps returning the same page still fails: at once when its elements carry an id-like key such as `id` or `name`, and at the page cap when they don't.
* **dynamic:** send no File batch when every listed file answers 404, since a wrong fileservice URL or missing access looks the same and the batch would delete every File object. A partial 404 still leaves those files out with deletes unaffected.
* **dynamic:** skip the DataProducer metadata call for a pipeline with files but no data mappings.

## [1.0.7](https://github.com/zerobias-org/collectorbot/compare/@zerobias-org/collectorbot-zerobias-zerobias-dynamic@1.0.6...@zerobias-org/collectorbot-zerobias-zerobias-dynamic@1.0.7) (2026-04-16)

### Bug Fixes

* **dynamic-collector:** pin logger override to dedupe nested install (#16)


## [1.0.6](https://github.com/zerobias-org/collectorbot/compare/@zerobias-org/collectorbot-zerobias-zerobias-dynamic@1.0.5...@zerobias-org/collectorbot-zerobias-zerobias-dynamic@1.0.6) (2026-04-16)

### Bug Fixes

* **dynamic-collector:** preserve modifiers/validation fields in mapping rules


## [1.0.5](https://github.com/zerobias-org/collectorbot/compare/@zerobias-org/collectorbot-zerobias-zerobias-dynamic@1.0.3...@zerobias-org/collectorbot-zerobias-zerobias-dynamic@1.0.5) (2026-04-15)

### Bug Fixes

* **deps:** bump logger override 3.0.3 → 3.0.6, bump dynamic to 1.0.4

### Chores

* **release:** bump version
* **release:** bump version
* **release:** bump version
* **release:** bump version
* **release:** bump version
* **release:** bump version


## [1.0.3](https://github.com/zerobias-org/collectorbot/compare/@zerobias-org/collectorbot-zerobias-zerobias-dynamic@1.0.3...@zerobias-org/collectorbot-zerobias-zerobias-dynamic@1.0.3) (2026-04-02)

### Chores

* **release:** bump version
* **release:** bump version
* **release:** bump version
* **release:** bump version
* **release:** bump version


## [1.0.3-rc.4](https://github.com/zerobias-org/collectorbot/compare/@zerobias-org/collectorbot-zerobias-zerobias-dynamic@1.0.2...@zerobias-org/collectorbot-zerobias-zerobias-dynamic@1.0.3-rc.4) (2026-04-01)

### Chores

* **release:** bump version
* **release:** bump version
* **release:** bump version
* **release:** bump version


## [1.0.3-rc.3](https://github.com/zerobias-org/collectorbot/compare/@zerobias-org/collectorbot-zerobias-zerobias-dynamic@1.0.2...@zerobias-org/collectorbot-zerobias-zerobias-dynamic@1.0.3-rc.3) (2026-04-01)

### Chores

* **release:** bump version
* **release:** bump version
* **release:** bump version


## [1.0.3-rc.2](https://github.com/zerobias-org/collectorbot/compare/@zerobias-org/collectorbot-zerobias-zerobias-dynamic@1.0.2...@zerobias-org/collectorbot-zerobias-zerobias-dynamic@1.0.3-rc.2) (2026-04-01)

### Chores

* **release:** bump version
* **release:** bump version


## [1.0.3-rc.1](https://github.com/zerobias-org/collectorbot/compare/@zerobias-org/collectorbot-zerobias-zerobias-dynamic@1.0.2...@zerobias-org/collectorbot-zerobias-zerobias-dynamic@1.0.3-rc.1) (2026-04-01)

### Chores

* **release:** bump version


## [1.0.3-rc.0](https://github.com/zerobias-org/collectorbot/compare/@zerobias-org/collectorbot-zerobias-zerobias-dynamic@1.0.2...@zerobias-org/collectorbot-zerobias-zerobias-dynamic@1.0.3-rc.0) (2026-04-01)

**Note:** Version bump only for package @zerobias-org/collectorbot-zerobias-zerobias-dynamic





## [1.0.2](https://github.com/zerobias-org/collectorbot/compare/@zerobias-org/collectorbot-zerobias-zerobias-dynamic@1.0.1...@zerobias-org/collectorbot-zerobias-zerobias-dynamic@1.0.2) (2026-03-30)

### Bug Fixes

* fix dep issuees


## [1.0.1](https://github.com/zerobias-org/collectorbot/compare/@zerobias-org/collectorbot-zerobias-zerobias-dynamic@0.1.2...@zerobias-org/collectorbot-zerobias-zerobias-dynamic@1.0.1) (2026-03-30)

### Bug Fixes

* try again
* try again


## <small>0.1.2 (2026-03-04)</small>

* feat(dynamic): migrate to ESM with @zerobias-org module ([c964cf6](https://github.com/zerobias-org/collectorbot/commit/c964cf6))





## <small>0.1.1 (2026-03-02)</small>

* fix: include npm-shrinkwrap.json in published packages ([3c76efa](https://github.com/zerobias-org/collectorbot/commit/3c76efa))





## 0.1.0 (2026-03-02)

**Note:** Version bump only for package @zerobias-org/collectorbot-zerobias-zerobias-dynamic





# [0.1.0-rc.3](https://github.com/zerobias-org/collectorbot/compare/@zerobias-org/collectorbot-zerobias-zerobias-dynamic@0.1.0-rc.2...@zerobias-org/collectorbot-zerobias-zerobias-dynamic@0.1.0-rc.3) (2026-01-28)


### Bug Fixes

* **dynamic-collector:** receive pipeline params via run() argument ([9b60776](https://github.com/zerobias-org/collectorbot/commit/9b607762d350ef72c3f4d9537f791beb4aa17ec0))





# [0.1.0-rc.2](https://github.com/zerobias-org/collectorbot/compare/@zerobias-org/collectorbot-zerobias-zerobias-dynamic@0.1.0-rc.1...@zerobias-org/collectorbot-zerobias-zerobias-dynamic@0.1.0-rc.2) (2026-01-26)


### Features

* **dynamic:** implement data mapping with DataMapper ([9090301](https://github.com/zerobias-org/collectorbot/commit/9090301aedede1c02788d1cd0e6cb7c745f82d08))





# [0.1.0-rc.1](https://github.com/zerobias-org/collectorbot/compare/@zerobias-org/collectorbot-zerobias-zerobias-dynamic@0.1.0-rc.0...@zerobias-org/collectorbot-zerobias-zerobias-dynamic@0.1.0-rc.1) (2025-12-23)


### Bug Fixes

* update module and produc ids ([c1638e7](https://github.com/zerobias-org/collectorbot/commit/c1638e71a36312ff6d5d385a5e2e6936435a9287))





# 0.1.0-rc.0 (2025-12-23)


### Features

* add dynamic collector ([9210e6a](https://github.com/zerobias-org/collectorbot/commit/9210e6a0104c7eb73ec9eec766ce9fbdd0f26736))
