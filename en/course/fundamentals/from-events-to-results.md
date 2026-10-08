# From events to results

> How a source, a filter, a transformation, and a sink turn mixed events into one result.

Source: https://stream-processing-systems.github.io/en/course/fundamentals/from-events-to-results/

In our grocery service, each change to an order is recorded as an
[event](https://stream-processing-systems.github.io/en/course/fundamentals/what-an-event-tells-us.md). At the store, the courier desk needs to know
when an order is packed, so that a courier can collect it. The order's events
also include proposals, answers, and deliveries. Sending all of them to the desk
would bury the one fact it needs. How do we turn a flow of mixed events into the
result the desk needs?

## Where the events come from

Processing starts from a **source**: the place where it gets its input records.
Here the source hands over the order events from the store's system as they
arrive. The source is not the store floor where the picker works. It only
provides records about what happened there.

For order `ord-1042`, the source provides seven events, from `order_placed` at
10:00 to `order_delivered` at 10:25. Only one of them matters to the courier
desk.

## Keep only the packing events

The first step is a **filter**. It asks one question about each record: is its
`event_type` equal to `order_packed`? If yes, the record moves on. If not, the
filter drops it from this path. For `ord-1042`, six events are dropped and one
moves on:

```json
{
  "event_id": "evt-005",
  "event_type": "order_packed",
  "order_id": "ord-1042",
  "store_id": "store-418",
  "occurred_at": "2026-10-21T10:09:00Z",
  "data": {}
}
```

Dropping a record here does not delete it. Other parts of the system can still
use the proposal and your answer; they just do not belong in the courier desk's
feed.

## Shape the result

The packing event still carries more than the desk needs. The desk does not use
the event's identity or type, and `data` is empty. It needs to know which order,
at which store, and when packing finished.

The second step is a **transformation**: a rule that builds a new record from
the input. It copies `order_id` and `store_id` and renames `occurred_at` to
`packed_at`. Every event has an `occurred_at` field, so the name is general. In
the output, packing is the only thing that happened, so `packed_at` says exactly
what the time means:

```json
{
  "order_id": "ord-1042",
  "store_id": "store-418",
  "packed_at": "2026-10-21T10:09:00Z"
}
```

## The whole path

Together, the filter and the transformation make up a **processor**: the
component that applies rules to each record. Its output goes to a **sink**: the
place where the results end up. Here the sink is the courier desk's feed. In
other systems, it could be a database, a file, or the input of another
processor.

![Source, processor, and sink](diagrams/whole-path.svg)

Source, processor, and sink are roles. A small program can play all three, and
a large system can spread them across many machines.

## What the rule does not know

The processor handles each packing event on its own: it does not look at
earlier events and remembers nothing between them.

If the same packing event reaches the processor twice, the desk gets two
identical updates. The rule has no way to tell that it has already seen this
record.

The feed is a list of things that happened, not a table of current statuses. It
says that `ord-1042` was packed at 10:09. It does not say that the order is
still waiting for a courier, and in fact a courier collected it at 10:12. The
sink receives each update, but showing it to a courier is a separate job.

Some questions need exactly the memory this rule lacks. The store keeps
[a list of orders waiting for a customer's answer](https://stream-processing-systems.github.io/en/course/introduction/why-stream-processing.md).
The proposal at 10:04 puts
`ord-1042` on that list, and your acceptance at 10:06 takes it off. Looking at
the acceptance alone, the processor cannot tell whether the order was on the
list at all. What does it need to keep between events to answer that?

## What to remember

- A source provides input records, a processor applies rules to them, and a
  sink receives the results.
- A filter keeps the records a result needs. A transformation builds the result
  from them.
- This packing rule looks at one event at a time and remembers nothing between
  events.
- Such a rule cannot notice a repeated event or answer a question that depends
  on earlier events.
