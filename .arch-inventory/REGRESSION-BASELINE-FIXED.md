# Regression baseline (verified after Neural Relay event-fabric consolidation)

`npm run test:packages` → **exit 0** (all 13 packages)
`npm run build:packages` → **exit 0**

Per package: cache 18 · prompt 340 · design 52 · context 14 · wiki 14 · router 124 ·
runtime 109 · memory #fail 0 (19 pass) · architecture #fail 0 (71 pass) ·
outcome #fail 0 (32 pass) · intelligence #fail 0 · brain #fail 0 · neural-relay 36.

## Changes verified against this green baseline
1. router openrouter.test.ts — stale ai-gateway assertion fixed.
2. outcome/src/evidence/collector.ts — deleted (verified dead).
3. **Neural Relay event fabric unified**: `@singularity/context/src/relay/fabric.ts`
   now owns the ONE generic `InMemoryRelayBus` + `RelayEventBuffer` +
   `RelayOutboxPublisher`; exported via new additive subpath `./relay`.
   - architecture/events/{memoryBus,localBuffer,outboxPublisher}.ts → delegates
     (FIFO shed, 50ms outbox, type-name bus matching preserved).
   - outcome/events/* → delegates (FIFO shed, 1000ms outbox default preserved).
   - memory/events/{schemas,buffer,publisher}.ts → delegates (`*` wildcard bus,
     priority-based shed via shedVictimIndex, recordReceived metric,
     saturateForTest, 40-tick flush default preserved).
   - Triplicated helpers (`newEventId`, `eventTypeName`, `parseEventTypeName`)
     now re-exported from the shared relay in all three planes.
   Per-plane behavior verified by each plane's own suite after migration.
