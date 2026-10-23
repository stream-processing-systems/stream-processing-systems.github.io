# Sliding and session windows

> Windows that overlap, windows shaped by the data itself, and what a late record does to each.

Source: https://stream-processing-systems.github.io/en/course/time/sliding-and-session-windows/

At `store-418`, the supervisor counts packed orders in
[ten-minute windows](https://stream-processing-systems.github.io/en/course/time/putting-events-into-time-windows.md) by event time. At
10:14, though, the current window holds only four minutes of packing, so its
count is low no matter how well the store works. The supervisor would rather
see the last ten minutes at any moment, updated every five minutes: from 10:00
to 10:10, then from 10:05 to 10:15, then from 10:10 to 10:20.

These windows overlap. The packing of your order `ord-1042` at 10:09 falls into
both `[10:00, 10:10)` and `[10:05, 10:15)`. What does the processor keep when
one event belongs to several windows?

## Windows that overlap

A window of fixed length that starts more often than its length is called a
**sliding window**. It has two settings: the length, here ten minutes, and the
slide, how often a new window starts, here every five minutes. When the slide
is shorter than the length, the windows overlap, and each event falls into
several of them.[^1]

Here are the orders packed at `store-418` between 10:00 and 10:12, and the
windows each one falls into:

| Order | Packed (event time) | Windows |
| --- | --- | --- |
| `ord-1047` | 10:03:00 | `[09:55, 10:05)`, `[10:00, 10:10)` |
| `ord-1042` | 10:09:00 | `[10:00, 10:10)`, `[10:05, 10:15)` |
| `ord-1337` | 10:09:59 | `[10:00, 10:10)`, `[10:05, 10:15)` |
| `ord-1051` | 10:10:00 | `[10:05, 10:15)`, `[10:10, 10:20)` |
| `ord-1055` | 10:11:00 | `[10:05, 10:15)`, `[10:10, 10:20)` |

The processor still keeps one count for each store and window, as with
[tumbling windows](https://stream-processing-systems.github.io/en/course/time/putting-events-into-time-windows.md). The difference is that
each event now adds one to two counts instead of one. To find them, the
processor takes the windows that start at a multiple of five minutes no later
than the event time and end after it. For 10:09, those are the windows that
start at 10:00 and at 10:05.

![One event in two overlapping windows](diagrams/sliding-windows.svg)

With a ten-minute window and a five-minute slide, every event updates two
counts. With a one-minute slide, the supervisor's view would refresh every
minute, but every event would update ten counts instead of two, and new windows
would start five times as often, so the processor would keep five times as many
counts. A smoother view costs more state and more work.

The counts also cannot be added together. `[10:00, 10:10)` holds three orders
and `[10:05, 10:15)` holds four so far, but the store packed five orders, not
seven: `ord-1042` and `ord-1337` sit in both windows. Each count answers the
question for its own ten minutes.

## Windows shaped by activity

Tumbling and sliding windows are drawn on the clock in advance: every window
has a known start and end before any event arrives. Some questions are about
periods that only the data can mark. To see one, we leave the grocery store
for a different service.

Imagine a map for electric-car drivers that shows which public chargers are in
use. While a car is charging, a charger sends a reading every few minutes.
When no car is charging, it sends nothing. The map wants to know how long each
charger has been in use, and whether it is in use now. As with orders, each
charger's readings share a [key](https://stream-processing-systems.github.io/en/course/fundamentals/grouping-events-by-key.md), the
charger ID, and the periods go by the event time of the readings.

A period of use has no fixed length: one car charges for twenty minutes,
another for two hours. What marks its end is silence, a long enough pause
between readings. A window that groups events separated by short gaps and ends
after a longer gap is called a **session window**.[^2] Its length depends on the
events inside it.

The map uses a gap of ten minutes. Readings less than ten minutes apart belong
to one session. Each session runs from its first reading until ten minutes
after its last one, because only then has the silence lasted long enough.

Here are the readings from charger `charger-7` one morning, all times in UTC:

| Reading (event time) | Gap since the previous reading | Session |
| --- | --- | --- |
| 09:01 | None | 1 |
| 09:04 | 3 minutes | 1 |
| 09:09 | 5 minutes | 1 |
| 09:24 | 15 minutes | 2 |

The pause from 09:09 to 09:24 is longer than ten minutes, so the readings form
two sessions: `[09:01, 09:19)` with three readings and `[09:24, 09:34)` with one.
The map treats them as two periods of use, perhaps two different cars, with
the charger free in between.

## A late event can join two sessions

Now a reading from 09:16 arrives late: the charger's mobile connection was weak,
and the reading reached the map's processor only after the others. Its gap from
09:09 is seven minutes, and its gap to 09:24 is eight. Both are shorter than
ten minutes, so the late reading fills the pause, and the two sessions become
one: `[09:01, 09:34)` with five readings. The readings do not say whether one
car charged all that time or two cars followed each other within a few
minutes. They only show that the charger never went quiet for ten minutes.

![A late reading joins two sessions](diagrams/session-merge.svg)

With tumbling and sliding windows, a late event joins a window whose boundaries
stay the same, and only its count changes. With session windows, a late event
can move the boundaries themselves and join two windows into one.[^3]

The map has already shown the wrong picture: two periods of use and a free spell
between them. To correct it, a new session with five readings is not enough. The
map also has to learn that the two earlier sessions no longer exist, or it will
show the same charging twice. So the processor has to say which earlier results
the new one replaces.

The late reading also shows how little silence proves. At 09:19, the map had no
readings from `charger-7` for ten minutes and could have marked the charger as
free. In fact, the charger was still sending readings, and one of them was stuck on
the way.
Silence from a charger means only that no readings have arrived. It does not
mean the charger is free.

## Choosing the window

| Window | Boundaries | An event falls into | Fits questions like |
| --- | --- | --- | --- |
| Tumbling | Fixed on the clock, no overlap | Exactly one window | How many orders were packed from 10:00 to 10:10? |
| Sliding | Fixed on the clock, overlapping | Several windows | How many orders were packed in the last ten minutes? |
| Session | Set by the events and a gap | One window, which can grow or merge | How long was the charger in use? |

The question picks the window. The supervisor's report needs periods on the
clock, and the charger map needs periods of activity.

All three kinds have the same weak spot. The supervisor's count for
`[10:00, 10:10)` grew after 10:10 when late records arrived. The charger's
session looked finished at 09:19, and a late reading changed it. In both cases,
the processor had to decide when a window is over while earlier events might
still be on their way. Its own clock cannot tell it that, and neither can the
latest event time it has seen. How does a processor know how far the stream has
progressed in event time?

## What to remember

- A sliding window has a length and a slide. When the slide is shorter than
  the length, windows overlap, and each event updates several results, which
  cannot be added together.
- A session window groups events separated by gaps shorter than a chosen
  length. Its boundaries depend on the events.
- A late event can merge two sessions, so the processor has to replace earlier
  results, not just add a new one.
- Silence from a source means that no events have arrived. It does not prove
  that nothing happened.

## References

[^1]: [Apache Flink 2.3: Sliding Windows](https://nightlies.apache.org/flink/flink-docs-release-2.3/docs/dev/datastream/operators/windows/#sliding-windows).
[^2]: [Apache Flink 2.3: Session Windows](https://nightlies.apache.org/flink/flink-docs-release-2.3/docs/dev/datastream/operators/windows/#session-windows).
[^3]: [Apache Flink 2.3: Late elements considerations](https://nightlies.apache.org/flink/flink-docs-release-2.3/docs/dev/datastream/operators/windows/#late-elements-considerations).

## Further reading

- Josh Fischer and Ning Wang, *[Grokking Streaming Systems](https://www.manning.com/books/grokking-streaming-systems)*
  (Manning, 2022), chap. 7, "Windowed Computations." Shows fixed, sliding, and
  session windows side by side on one illustrated example.
- Tyler Akidau, Slava Chernyak, and Reuven Lax, *[Streaming Systems](https://www.oreilly.com/library/view/streaming-systems/9781491983867/)*
  (O'Reilly Media, 2018), chap. 4, "Advanced Windowing." Explains how session
  windows are built by merging smaller windows, and how a system replaces
  results when sessions merge.
