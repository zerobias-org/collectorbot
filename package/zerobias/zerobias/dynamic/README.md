# @zerobias-org/collectorbot-zerobias-zerobias-dynamic

## Description

Collector bot for ZeroBias Data Producer Interface. This collector provides a flexible interface for collecting data from various data producers using dynamically configured operations.

## Key Features

- **Dynamic Schema Support**: Target schema classes are configured in parameters rather than being hardcoded
- **Multiple Operation Types**: Supports both list-based and single-object operations
- **Flexible Parameters**: Each operation can have its own parameter configuration

## Data Collection Operations

### Multi-Element Operations

These operations return multiple items (PagedResults):

- **getChildren**: Retrieves child objects of a given parent object
- **objectSearch**: Searches for objects matching criteria
- **getCollectionElements**: Retrieves elements from a collection
- **searchCollectionElements**: Searches collection elements with filters

### Single-Element Operations

These operations return a single object:

- **getRootObject**: Retrieves the root object
- **getObject**: Retrieves a specific object by ID
- **getCollectionElement**: Retrieves a specific collection element

## Configuration

This collector requires operation configurations specified in parameters. Each operation config includes:

- `operationType`: The type of operation to execute (from the list above)
- `className`: Target schema class name for the results
- `operationParameters`: Parameters specific to the operation

See USERGUIDE.md for detailed parameter configuration examples.

## GroupId Strategy

This collector uses pipeline ID for grouping:
- `${pipelineId}` - Ensures data isolation per pipeline execution

## Development

```bash
npm install
npm run build
npm run lint
npm run test:integration
```

## Notes

- Mapping is currently placeholder-based (obj => obj)
- Schema classes are dynamically determined from parameters
- Designed for maximum flexibility in data collection scenarios
