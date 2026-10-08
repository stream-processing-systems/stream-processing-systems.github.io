# When one event is not enough

> Why some results depend on earlier events, and what a processor keeps between them.

Source: https://stream-processing-systems.github.io/en/course/fundamentals/when-one-event-is-not-enough/

In our grocery service, the store keeps a list of orders waiting for a
customer's answer. When a picker proposes a replacement, the order joins the
list, so store staff can see that the picker is waiting. When the customer
answers, the order leaves the list. For your order `ord-1042`, the picker
proposed green apples instead of red ones at 10:04, and you accepted at 10:06.

The [courier desk's feed](https://stream-processing-systems.github.io/en/course/fundamentals/from-events-to-results.md) was built from one event
at a time. This list is different. Your acceptance at 10:06 should take the
order off the list, but only because the proposal at 10:04 put it there. How
does a processor build a result that depends on events it has already seen?

## Why a filter is not enough

The processor we already have keeps some events and reshapes them. Suppose we
use it here and keep every `replacement_proposed` event. The result is a feed
of questions that pickers asked. The proposal from 10:04 stays in that feed
after you answer, so the feed cannot say who is still waiting. Keeping
`replacement_accepted` events instead gives a feed of answers, and that cannot
say who is waiting either.

The list needs both kinds of events and the link between them: a proposal opens
a question, and the answer closes it. Neither event says on its own whether the
order is waiting right now.

## Remember between events

So the processor has to keep something from one event to the next. That
information is **state**: what a processor remembers from earlier events and
uses when the next one arrives. A processor that keeps state is **stateful**.
The packing rule kept nothing between events, so it was **stateless**.[^1]

For your order, the processor remembers one thing: is the order waiting for an
answer? A replacement proposal sets it to yes, the customer's answer sets it to
no, and any other event leaves it as it was.

![The rule reads and writes the order's state](diagrams/stateful-path.svg)

Here is how the remembered answer changes as the events of `ord-1042` arrive:

| Time | Event | Waiting for an answer? |
| --- | --- | --- |
| 10:00 | `order_placed` | No |
| 10:02 | `picking_started` | No |
| 10:04 | `replacement_proposed` | Yes |
| 10:06 | `replacement_accepted` | No |
| 10:09 | `order_packed` | No |
| 10:12 | `courier_collected` | No |
| 10:25 | `order_delivered` | No |

When the answer changes, the processor sends an update to the list: add
`ord-1042` at 10:04, remove it at 10:06. When an event leaves the answer as it
was, like packing at 10:09, the list has nothing to change. To tell the two
cases apart, the processor compares the new answer with the one it remembered.

The result is also a different kind of thing from the courier desk's feed. The
feed reports what happened. The waiting list shows
[current state](https://stream-processing-systems.github.io/en/course/fundamentals/what-an-event-tells-us.md): which orders are waiting right now.
The processor keeps its own copy of that answer to work out the next change.
This memory can be a variable in a running program or a row in a database.

## How much to remember

The processor could keep every event of the order, but this list needs only a
yes or no. Other questions need different state:

| Question | What the processor keeps |
| --- | --- |
| Is the order waiting for an answer? | Yes or no |
| What did the picker propose? | The proposed item, until the answer arrives |
| Which replacements did the order have? | The replacement events themselves |

Keeping more than the question needs costs storage and work on every event.
Keeping less makes some answers impossible: from a yes or no alone, the
processor cannot tell staff that green apples were proposed.

The yes or no also relies on how our store works. A picker proposes one
replacement at a time and waits for the answer. If a picker could propose two
at once, say apples and bread, your answer about the apples would set the order
to no while the bread still waits. The processor would then need to remember
each open proposal.

So far we have followed one order. The store handles many at once, and their
events arrive mixed together. While you are deciding about the apples, a picker
working on another order, `ord-1337`, proposes the same green apples at 10:05.
That event arrives between the proposal for your order and your acceptance. Your
acceptance should take your order off the list and leave `ord-1337` on it. How
does the processor keep the memory of each order apart?

## What to remember

- Some results depend on earlier events. A rule that uses only the current
  event and remembers nothing between events cannot produce them.
- State is what a processor remembers between events. A processor that keeps
  state is stateful.
- The waiting list shows current state: which orders are waiting right now.
- Keep the state the question needs: a yes or no here, more for other
  questions.

## References

[^1]: [Apache Flink 2.3: What is State?](https://nightlies.apache.org/flink/flink-docs-release-2.3/docs/concepts/stateful-stream-processing/#what-is-state).
