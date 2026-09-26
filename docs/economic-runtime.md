# Economic Runtime integration

Session Router remains responsible for candidate eligibility, ranking, preflight and failover.

Economic authorization is a separate boundary:

```text
ROUTE selects candidate
  ↓
EconomicExecutionGate.authorize()
  ↓
RUN executes
  ↓
on failure: release reservation
on completion: mark execution complete
  ↓
meter + rail settlement remain downstream
```

Use `withEconomicExecutionGate()` to wrap a `SessionExecutor`.

A completed Session Router attempt is intentionally **not** a value-settlement claim. The gate may reserve or authorize spend before execution, but final metering and settlement belong to the Economic Runtime / rail layer.

Reference implementation: https://github.com/retardio73-boop/flop-economic-runtime
