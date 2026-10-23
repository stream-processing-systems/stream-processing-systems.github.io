# Event time and processing time

> Why a record has two times, when it happened and when it was processed, and how to choose between them.

Source: https://stream-processing-systems.github.io/en/course/time/event-time-and-processing-time/

In our grocery service, a processor keeps the store's
[list of orders waiting for a customer's answer](https://stream-processing-systems.github.io/en/course/fundamentals/when-one-event-is-not-enough.md).
For your order `ord-1042`, the picker proposed green apples at 10:04, and you
accepted at 10:06. But the proposal was delayed on its way, and your acceptance
reached the processor first. Applied in the order they arrived, the late
proposal put your order on the list after you had already answered.

One way out is to hold incoming events for a while and apply them in the order
they happened. How long should the processor hold them? To answer that, we need
to separate two times that belong to every record: when something happened,
and when the processor handled its record.

## Two times for one record

The time when something happened is its **event time**. In our service, the
source writes it into each event as
[`occurred_at`](https://stream-processing-systems.github.io/en/course/fundamentals/what-does-an-event-tell-us.md). The time when a
processor handles a record is its **processing time**: what the processor's own
clock shows at that moment.[^1] The record does not carry its processing time.
The processor reads it from its clock.

Here are three events of your order with both times:

| Event | Event time | Processing time |
| --- | --- | --- |
| `evt-003`, `replacement_proposed` | 10:04:00 | 10:06:20 |
| `evt-004`, `replacement_accepted` | 10:06:00 | 10:06:05 |
| `evt-005`, `order_packed` | 10:09:00 | 10:11:00 |

By event time, the proposal comes two minutes before the acceptance. By
processing time, it comes fifteen seconds after. The gap between the two clocks
is also different for each record: 2 minutes 20 seconds for the proposal, 5
seconds for the acceptance, 2 minutes for packing. It depends on the network,
on how busy the machines are, and on things like a picker's scanner losing
Wi-Fi for a moment.

Processing time belongs to a particular processor. If a record passes through
two processors, each one handles it at its own moment, so the record gets two
processing times. When someone says that a record arrived at 10:06:20, it is
worth asking: arrived where?

## How long to hold events

Back to the waiting list. Suppose the processor holds each event for 30 seconds
of processing time. When an event's 30 seconds are up, the processor applies
it together with every held event that happened before it, oldest first.

Your acceptance arrives at 10:06:05 and waits until 10:06:35. The proposal
arrives at 10:06:20, during that wait. At 10:06:35, the processor applies the
proposal and then the acceptance. Your order joins the list and leaves it at
once, which is right: you have already answered.

![Holding events for 30 seconds](diagrams/hold-and-apply.svg)

Other holds give other results:

| Hold | What happens to your order | Is the list right? |
| --- | --- | --- |
| None | Joins at 10:06:20 and stays | No: it stays on the list after you answered |
| 10 seconds | Joins at 10:06:30 and stays | No: the acceptance was applied at 10:06:15, before the proposal arrived |
| 30 seconds | Joins and leaves at 10:06:35 | Yes |
| 5 minutes | Joins and leaves at 10:11:05 | Yes, but the list changes only at 10:11:05 |

A longer hold lets more late events find their place, but any update can
wait up to the whole hold, including updates from events that were not late
at all. Applying events in the order they happened always costs some waiting,
unless they already arrive in that order.[^1]

And no hold is long enough for certain. If a picker's scanner stays offline for
ten minutes, its events arrive ten minutes late. From the records it has
already seen, the processor cannot tell whether an earlier one is still on its
way. So the hold is a choice between waiting and being wrong. It depends on how
late events usually are and on how far behind the list may fall.

## When there is no need to wait

For this list, there is another approach. The processor can remember, for each
order, the event time of the last change it applied. When an event arrives with
an earlier event time, a newer change has already been applied, so the
processor ignores the older one.

Your acceptance from 10:06 is applied as soon as it arrives. The proposal from
10:04 comes later, and the processor ignores it because 10:04 is earlier than
10:06. Your order never joins the list, and nothing has to wait.

This works because the list needs only the latest answer for each order, and a
newer change replaces an older one completely. A result that needs the whole
story, such as every replacement of an order in the order they happened, cannot
drop a late event. It has to put the event in its place.

Both approaches trust `occurred_at`. Event time is what the source wrote, so it
is only as good as the clock that wrote it. If a scanner's clock runs two
minutes behind, its events carry times two minutes too early, and comparing
them with events from other devices can pick the wrong one.

## Choose the clock for the question

Event time is not always the right clock. The packing of your order happened
at 10:09, and the processor handled it at 10:11. Two people ask about the same
record:

| Question | Who asks | Clock | Where the packing of `ord-1042` counts |
| --- | --- | --- | --- |
| How many orders did the store pack between 10:00 and 10:10? | The store's supervisor | Event time | 10:00 to 10:10 |
| How many records did the processor handle between 10:10 and 10:20? | An engineer watching the processor | Processing time | 10:10 to 10:20 |

Both answers are correct for their own questions. A count by processing time
describes the processor's work. If the network slows down, records move into
later periods, and the count changes even though the store packed as many
orders as before. A count by event time describes the store's work, and delays
do not move a record into another period.

Processing time has one big advantage: it is simple. The processor knows its
own clock, so when its clock shows 10:20, nothing more can join the period from
10:10 to 10:20. With event time, a packing record from 10:09 can still arrive
at 10:11 or later.

Event time pays off when the same records are processed again. Suppose the
store finds a bug in its processor and runs this morning's records through the
fixed version tomorrow. The event times stay the same, while every processing
time is now tomorrow. A count by event time puts each record into the same
period as before. A count by processing time puts them all into tomorrow.

The supervisor wants to see how fast the store packs orders, so they can call
in another picker when orders pile up. A total since the morning does not help,
because it only grows. They need a separate count for each ten-minute period by
event time: how many orders were packed from 10:00 to 10:10, from 10:10 to
10:20, and so on. The packing of your order at 10:09 belongs to the first
period, even though the processor handles it at 10:11. How does the processor
split a stream that never ends into periods like these and keep a count for
each?

## What to remember

- Event time is when something happened. The source writes it into the event.
  Processing time is what a processor's clock shows when it handles the record.
- The gap between the two clocks differs from record to record, so records can
  arrive in a different order from the events they describe.
- Holding events and applying them by event time trades delay for correctness,
  and no hold rules out a later event. Some results, like the latest answer for
  each order, can use event time without waiting.
- Choose the clock for the question: event time for what happened in the store,
  processing time for what the processor did.

## References

[^1]: [Apache Flink 2.3: Notions of Time: Event Time and Processing Time](https://nightlies.apache.org/flink/flink-docs-release-2.3/docs/concepts/time/#notions-of-time-event-time-and-processing-time).

## Further reading

- Tyler Akidau, Slava Chernyak, and Reuven Lax, *[Streaming Systems](https://www.oreilly.com/library/view/streaming-systems/9781491983867/)*
  (O'Reilly Media, 2018), chap. 1, "Streaming 101." Explains why the gap
  between event time and processing time keeps changing, and what that means
  for results grouped by time.
