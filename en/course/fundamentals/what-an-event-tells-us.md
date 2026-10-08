# What does an event tell us?

> What a useful event record contains, and how an event differs from a command and the current state.

Source: https://stream-processing-systems.github.io/en/course/fundamentals/what-an-event-tells-us/

In our [grocery delivery service](https://stream-processing-systems.github.io/en/course/introduction/why-stream-processing.md),
the system reacts to each change in an order as it arrives. The picker, the
store worker who collects your items, could not find red apples and proposed
green apples instead. You have just accepted. If the system receives only "order
updated", it cannot tell whether to show a new proposal or confirm the one you
accepted. What must a record of this change contain for the system to act
on it?

## The action and its record

At 10:06 you tap Accept. That action happens once, in the app. The
system then writes a record that describes it. This record is the **event**:
data that says what happened, along with the context needed to understand
it.[^1]

Unlike the action, the record can be stored, copied, and sent to other
programs. Reading it does not repeat the action: a
record saying that the order was packed does not pack anything. The record can
also reach a program some time after the action happened.

## What a useful event says

To act on your answer, the store needs several questions answered. Our
service puts each answer in its own field:

| Question | Field | In your acceptance |
| --- | --- | --- |
| What happened? | `event_type` | `replacement_accepted` |
| Which order? | `order_id` | `ord-1042` |
| Which store? | `store_id` | `store-418` |
| What details? | `data` | The accepted item: green apples 1kg |
| When did it happen? | `occurred_at` | 10:06 UTC on October 21, 2026 |
| Which record is this? | `event_id` | `evt-004` |

Put together, the event looks like this:

```json
{
  "event_id": "evt-004",
  "event_type": "replacement_accepted",
  "order_id": "ord-1042",
  "store_id": "store-418",
  "occurred_at": "2026-10-21T10:06:00Z",
  "data": {
    "replacement_item": "green apples 1kg"
  }
}
```

The `Z` at the end of the time means UTC, a shared time reference that does not
depend on the store's time zone.

Every event in our service has the same fields. Their values differ, and the
contents of `data` depend on what happened. A proposal needs both the original
item and the replacement. A packing event needs no details at all: its
type, order, and time already say which order was packed and when. Other systems
use different field names and layouts, but they answer the same questions.

## Recorded time and arrival time

`occurred_at` says when the acceptance happened: 10:06. It does not say when a
program received the record. The record might arrive at 10:06, or at 10:08 after
a network delay. To know the arrival time, the receiving program has to note it
separately.

Records can also arrive in a different order from the actions they describe. If
the proposal from 10:04 is delayed, the acceptance from 10:06 can arrive first.
A program that trusts arrival order would then see an answer before the question
it answers.

![The proposal happens first but arrives second](diagrams/arrival-order.svg)

## Event identity and order identity

`event_id` and `order_id` look alike but answer different questions. `event_id`
names one record. `order_id` names the order that the record is about.

One order collects many events. Order `ord-1042` has seven, from `evt-001` when
it was placed to `evt-007` when it was delivered. If a system used the order ID
to identify records, those seven facts would share one label and could not be
told apart. If it grouped records by event ID, each record would stand alone,
and the order's story would fall apart.

## Event, command, and current state

The same replacement can be described in three ways, and each means something
different:

| Kind | Example | What it says |
| --- | --- | --- |
| Event | `replacement_accepted` at 10:06 | Something happened in the past. |
| Command | "Please replace the red apples." | A request to the picker. The replacement may not have happened yet. |
| Current state | "Packed" | Where the order stands now, as some system sees it at a given moment. |

Mixing them up leads to wrong answers. If the system treated the command as an
event, it could tell you the green apples are in your bag before the picker has
taken them from the shelf. If it kept only the latest status, it would know that
the order is "Packed" but not when packing finished or that a replacement was accepted. A current
order record could store those details as extra fields. Events keep each change
itself: when the order is delivered, the status changes to "Delivered", and the
packing event from 10:09 is still there.

The store now has events with clear meanings, but it still needs results from
them. Suppose it wants a feed that announces each packed order. Your
acceptance belongs to the order's history, yet it says nothing about packing.
Which events should go into that feed, and what should each update in it
contain?

## What to remember

- An event is a record of something that happened. A useful event says what
  happened, to which order, when, and with which details.
- `occurred_at` is when something happened, not when its record arrived.
  Records can arrive in a different order from the actions they describe.
- The event ID names one record. The order ID connects all records about one
  order.
- An event reports the past, a command asks for an action, and the current state
  describes the present.

## References

[^1]: [CloudEvents v1.0.2 specification](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md).
