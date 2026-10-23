# Putting events into time windows

> How a processor splits an endless stream into time periods and keeps a separate result for each.

Source: https://stream-processing-systems.github.io/en/course/time/putting-events-into-time-windows/

At `store-418`, the supervisor watches how fast orders get packed. If the store
packs fewer orders than usual while new ones keep coming, the supervisor calls
in another picker. So they need a count of packed orders for each ten-minute
period: from 10:00 to 10:10, from 10:10 to 10:20, and so on. The periods go by
[event time](https://stream-processing-systems.github.io/en/course/time/event-time-and-processing-time.md). Your order `ord-1042` was
packed at 10:09, so it counts toward the period from 10:00 to 10:10, even
though the processor handled it at 10:11.

The processor reads `order_packed` events as they arrive, and the stream never
ends. A total since the morning would only grow. How does the processor cut the
stream into periods and keep a count for each?

## A period with its own result

A **window** groups events by time into a bounded piece of the stream, so the
processor can compute a separate result for each piece.[^1] Our windows are ten
minutes long, follow one another without gaps, and do not overlap, so each
event falls into exactly one of them. Windows like these are called **tumbling
windows**.[^2]

To set up windows, the processor needs a few decisions. Which clock: event
time, because the supervisor asks about the store's work. How long: ten
minutes. Where the periods start: at round times on the clock, 10:00, 10:10,
10:20, in UTC like `occurred_at` itself.

With these decisions, a record finds its window without any search. The
processor takes the event time and rounds it down to a multiple of ten minutes:
10:09:00 belongs to the window that starts at 10:00, and 10:13:30 to the one
that starts at 10:10.

## Where the boundary goes

One decision is left. An order packed at exactly 10:10:00 could belong to the
window that ends at 10:10 or to the one that starts there. If it counted in
both, the store would count one packed order twice. If it counted in neither,
the order would be lost.

We include the start and exclude the end: the first window covers 10:00:00 up
to, but not including, 10:10:00. This is written as `[10:00, 10:10)`. Flink, a
widely used stream processing engine, follows the same rule for its time
windows.[^3] Other systems can choose differently, so the rule has to be stated
along with the window length.

Here are the first orders packed at `store-418` after 10:00:

| Order | Packed (event time) | Handled (processing time) | Window |
| --- | --- | --- | --- |
| `ord-1047` | 10:03:00 | 10:03:01 | `[10:00, 10:10)` |
| `ord-1042` | 10:09:00 | 10:11:00 | `[10:00, 10:10)` |
| `ord-1337` | 10:09:59 | 10:12:00 | `[10:00, 10:10)` |
| `ord-1051` | 10:10:00 | 10:10:02 | `[10:10, 10:20)` |

`ord-1337` was packed one second before the boundary and stays in the first
window. `ord-1051` was packed exactly on the boundary and starts the second
one. By event time, the first window holds three packed orders.

Counted by processing time, the same records give a different picture: one
order in the first period and three in the second. The supervisor would see
packing speed up after 10:10. In fact, three of these orders were packed
before 10:10, and two of their records were simply late.

![The same records in event-time and processing-time windows](diagrams/windows-by-two-clocks.svg)

## State for each key and window

Each store has its own supervisor, so each count belongs to a store and a
window. The processor keeps these counts as
[state](https://stream-processing-systems.github.io/en/course/fundamentals/when-one-event-is-not-enough.md). The
[key](https://stream-processing-systems.github.io/en/course/fundamentals/grouping-events-by-key.md) is `store_id`, and
within each store, every window has its own count:

| Store | Window | Packed orders |
| --- | --- | --- |
| `store-418` | `[10:00, 10:10)` | 3 |
| `store-418` | `[10:10, 10:20)` | 1 |

When an `order_packed` event arrives, the processor reads `store_id`, finds the
window from `occurred_at`, and adds one to that row. If the row does not exist
yet, the processor creates it. An order packed at another store at 10:05 goes
to that store's row, even though its time falls into the same window. The
processor does not need to keep the events themselves: one number per row is
enough.

## Where a record belongs, and when a window is complete

Look at the processing times again. At 10:10:00 by the processor's clock, the
period of the first window is over, and its row shows 1. The packing of
`ord-1042` arrives at 10:11:00, and `ord-1337` at 10:12:00. Both still go to
`[10:00, 10:10)`, because the window is chosen by event time, and the row grows
to 3 two minutes after the period ended.

So the window tells the processor where each record belongs. It does not tell
when a window's count is complete. If the processor showed the supervisor the
count at 10:10 sharp, they would see 1 and a slowdown that never happened.

Fixed windows also limit what the supervisor can see between boundaries. At
10:14, the current window holds only four minutes of packing, so its count is
low by nature. The supervisor would rather see the last ten minutes at any
moment, updated every five minutes: from 10:00 to 10:10, then from 10:05 to
10:15, then from 10:10 to 10:20. These windows overlap, and that breaks the rule
that each event falls into exactly one window. The packing of your order at
10:09 would count in both `[10:00, 10:10)` and `[10:05, 10:15)`. What does the
processor keep when one event belongs to several windows?

## What to remember

- A window splits a stream into bounded periods, so each period has its own
  result. Tumbling windows have a fixed length and do not overlap, so each
  event falls into exactly one.
- A window needs a clock, a length, a starting point, and a boundary rule.
  Here the start is included and the end is excluded.
- The processor keeps a separate count for each key and window. A record finds
  its window from its event time.
- A window says where a record belongs, not when the window's count is
  complete.

## References

[^1]: [Apache Flink 2.3: Windows](https://nightlies.apache.org/flink/flink-docs-release-2.3/docs/dev/datastream/operators/windows/).
[^2]: [Apache Flink 2.3: Tumbling Windows](https://nightlies.apache.org/flink/flink-docs-release-2.3/docs/dev/datastream/operators/windows/#tumbling-windows).
[^3]: [Apache Flink 2.3: Window Assigners](https://nightlies.apache.org/flink/flink-docs-release-2.3/docs/dev/datastream/operators/windows/#window-assigners).

## Further reading

- Josh Fischer and Ning Wang, *[Grokking Streaming Systems](https://www.manning.com/books/grokking-streaming-systems)*
  (Manning, 2022), chap. 7, "Windowed Computations." Walks through fixed,
  sliding, and session windows on one illustrated example, a good next step if
  windows are new to you.
- Tyler Akidau, Slava Chernyak, and Reuven Lax, *[Streaming Systems](https://www.oreilly.com/library/view/streaming-systems/9781491983867/)*
  (O'Reilly Media, 2018), chap. 1, "Streaming 101." Compares windows by
  processing time and by event time and shows how late data affects each.
