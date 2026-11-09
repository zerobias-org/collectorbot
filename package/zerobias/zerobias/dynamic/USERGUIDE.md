# ZeroBias Data Producer Collector - Parameters Guide

This collector requires configuration of operations to execute. Each operation specifies what data to collect and how to process it.

## Parameters

### `operations` (required)

Array of operation configurations. Each operation specifies:

#### `operationType` (required)

The type of operation to execute. Available options:

**Multi-Element Operations** (return lists):
- `getChildren` - Get child objects of a parent
- `objectSearch` - Search for objects
- `getCollectionElements` - Get elements from a collection
- `searchCollectionElements` - Search collection elements with filters

**Single-Element Operations** (return single object):
- `getRootObject` - Get the root object
- `getObject` - Get a specific object by ID
- `getCollectionElement` - Get a specific collection element

#### `className` (required)

Target schema class name where the results will be stored. This must match an existing schema class in the system.

**Example:** `MyDataClass`, `CustomObject`, `CollectionItem`

#### `operationParameters` (optional)

Object containing parameters specific to the operation. Common parameters include:

- `objectId` - ID of the object to query (string)
- `pageNumber` - Page number for pagination (number, default: 1)
- `pageSize` - Number of items per page (number, default: 1000)
- `sortBy` - Field to sort by (string)
- `sortDir` - Sort direction: "asc" or "desc" (string)
- `filter` - Filter expression for search operations (string, RFC4515 format)
- `elementKey` - Primary key for collection elements (string)

## Example Configuration

### Example 1: Get Children of an Object

```json
{
  "operations": [
    {
      "operationType": "getChildren",
      "className": "ChildObject",
      "operationParameters": {
        "objectId": "/parent/path",
        "pageSize": 100,
        "sortBy": "name",
        "sortDir": "asc"
      }
    }
  ]
}
```

### Example 2: Search Objects with Filters

```json
{
  "operations": [
    {
      "operationType": "objectSearch",
      "className": "SearchResult",
      "operationParameters": {
        "objectId": "/search/root",
        "pageSize": 500
      }
    }
  ]
}
```

### Example 3: Get Root Object

```json
{
  "operations": [
    {
      "operationType": "getRootObject",
      "className": "RootObject"
    }
  ]
}
```

### Example 4: Multiple Operations

```json
{
  "operations": [
    {
      "operationType": "getRootObject",
      "className": "RootObject"
    },
    {
      "operationType": "getChildren",
      "className": "ChildObject",
      "operationParameters": {
        "objectId": "/",
        "pageSize": 1000
      }
    },
    {
      "operationType": "getCollectionElements",
      "className": "CollectionItem",
      "operationParameters": {
        "objectId": "/collections/main",
        "pageSize": 500
      }
    }
  ]
}
```

## Common Patterns

### Hierarchical Data Collection

Collect root object first, then collect children:

```json
{
  "operations": [
    {
      "operationType": "getRootObject",
      "className": "RootNode"
    },
    {
      "operationType": "getChildren",
      "className": "ChildNode",
      "operationParameters": {
        "objectId": "/"
      }
    }
  ]
}
```

### Collection Data Retrieval

Get all elements from a specific collection:

```json
{
  "operations": [
    {
      "operationType": "getCollectionElements",
      "className": "DataItem",
      "operationParameters": {
        "objectId": "/data/collection1",
        "pageSize": 1000
      }
    }
  ]
}
```

### Filtered Search

Search with specific filters:

```json
{
  "operations": [
    {
      "operationType": "searchCollectionElements",
      "className": "FilteredResult",
      "operationParameters": {
        "objectId": "/search/base",
        "filter": "(type=active)",
        "pageSize": 100
      }
    }
  ]
}
```

## Tips

1. **Page Size**: Default is 1000. Adjust based on your data volume and API limits.

2. **Multiple Operations**: Operations execute sequentially in the order specified.

3. **Object IDs**: Use forward slashes (/) to denote path hierarchy in objectId parameters.

4. **Schema Classes**: Ensure the className you specify exists in your schema configuration.

5. **Filters**: For search operations, use RFC4515 filter syntax (LDAP-style filters).

## Getting Object IDs

Object IDs typically follow a path-based structure:
- Root: `/`
- Child paths: `/parent/child`
- Collections: `/collections/name`

Consult your data producer's documentation for specific object ID formats.

## Data Mapping Failures (1.1.0)

A data mapping fails closed. When its source fetch fails part way, the collector logs an error on the mapping's batch,
which fails the batch and the job. Before 1.1.0 the partial list was imported with deletes on, which deleted every
object the list left out. If the error log itself can't be written, the batch is left open, which also fails the job.
The other mappings still run.

Collections are paged up to 10,000 pages, about 1,000,000 elements at 100 per page; a larger collection fails its
mapping. Before 1.1.0 paging stopped at 1000 pages (about 100,100 elements). A source that keeps returning the same page
fails its mapping too: at once when its elements carry an id-like key such as `id` or `name`, and at the page cap when
they don't.

## Pipeline Files (1.1.0)

The collector also collects the files attached to a dynamic pipeline. The platform keeps them in the pipeline's
`params.files`, managed through its pipeline files endpoints; they need no collector parameters.

Each run sends the listed files as one `File` batch in group `pipeline-files:<pipelineId>`, apart from the data
mappings' group. The batch is a full snapshot: it updates the objects of listed files and, with deletes on, deletes the
objects of files no longer listed. A record holds the file's `id`, its `name` as listed on the pipeline, the
`fileVersionId` and `size` of its latest ready version, and `mimeType` when fileservice has one. The platform builds
the same record when a file is added, so both match key for key; versioning does not depend on key order, since the
platform sorts keys before it hashes a version.

- **Which job:** only the job launched with `files` in its params, the first job of a run, collects them, from the list
  the pipeline holds when the job runs. Preview runs skip files.
- **Uploaded files** are read from fileservice as they are.
- **Hub files** are copied from their Hub target again first, so the latest remote contents become a new version. The
  collector waits up to 30 s per file and 120 s per run for the copy, then records the version that is ready. A copy
  fileservice refuses is not retried, and the file can't be refreshed (see *When a File Is Missing*): 409 when Hub
  refused it, 404 when the object is gone from the target.

### How Each File Resolves

| fileservice says | Record | Deletes |
|---|---|---|
| a ready version with a size | sent | unaffected |
| 404 | left out | off, and the batch fails |
| 404 or 409 to a Hub file's copy | the version fileservice already has | off, and the batch fails |
| no ready version yet | left out | unaffected |
| a ready version without a size | left out | off |
| any other error, or not reached by the deadline | left out | off |
| a malformed entry | skipped | off |

### When a File Is Missing

A file that can't be refreshed fails the run's File batch. That is a file fileservice answers 404 for, because it was
deleted or this job can't see it. It is also a Hub file whose copy fileservice answers with:
- **404:** the object is no longer at its location on the target.
- **409:** Hub refused the copy, as it does for a deleted connection, expired credentials or revoked access.

What happens then:
- **The File batch** still carries every record it has, a Hub file's at the version fileservice already has. Its
  deletes are off, and it gets one error that names each such file, marked terminal (`transient: false`).
- **On the platform**, that batch fails while the run's other batches import, and the pipeline shows an error. Every
  File object keeps its last version. This holds when every listed file answers 404 too; a wrong fileservice URL or
  missing access looks the same, and the error says so.
- **Every data mapping that reads such a file** fails as well, without reading it. Its batch gets the same terminal
  error and its objects keep their last version. The other mappings run.

It clears once the file is back at its source, is picked again, or is removed from the pipeline.

### When a File Is Removed

Removing a file from the pipeline deletes its File object: the platform imports the snapshot without it. On the next
run, a mapping that reads a file the pipeline no longer lists reads nothing:
- **No other mapping of the run writes its class:** the class gets one empty batch. Its deletes give the class's
  objects deleted, empty versions.
- **Another mapping writes its class:** that mapping's batch is left to do it. Its deletes already take out the objects
  it no longer sends, and an empty batch of the same class and group would delete that mapping's objects too.

The mappings stay configured and collect nothing until they are repointed or deleted. A run only takes a mapping for
removed when it read the pipeline's list right before the File batch, and a preview run never does.

### Changes During a Run

Right before it creates the File batch, the collector reads the pipeline's file list again, so an add or remove made
while it ran is not undone. A file removed meanwhile is left out of the batch. A file added meanwhile is collected too,
within the same deadline and copy-wait budget, because the run's batch supersedes the platform's own snapshot of the add
and must carry its record. It resolves like any other file: unresolved turns deletes off, 404 fails the batch. If the
list can't be read again, deletes are off.

When deletes are off, the batch carries a warning that says why, and nothing is deleted; the objects of removed files
are deleted by the next run with deletes on.

### When No File Batch Is Sent

- **No file produced a record, none failed, and deletes are off**, since such a batch would change nothing.
- **The pipeline no longer has a `files` key.**

An empty list still sends an empty batch, which deletes the objects of removed files.

### Deadline

Collecting files has 10 minutes in all. Files not collected by then count as unresolved, which turns deletes off, and
the data mappings still run afterwards. Each fileservice call is bounded by the deadline too: an attempt is cut off when
the deadline comes, and none is started, or retried, with less than a second left.

### Reaching fileservice

The collector calls fileservice with the job's org API key. It uses `FILE_SERVICE_API` when the environment sets it, as
it does for hub-client jobs and the slot collector; otherwise it takes the hub server URL and replaces a trailing
`/hub` with `/file-service`.

A call that gets no answer, times out (60 s per attempt) or is answered 429, 502, 503 or 504 is retried, up to four
attempts, 0.5 s, 1 s and 2 s apart. Any other answer, such as 404 or 409, is final.
