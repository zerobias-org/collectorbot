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
