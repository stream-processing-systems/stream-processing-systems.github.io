# Keeping each order's story together

> How a key keeps each order's memory apart when events from many orders arrive mixed together.

Source: https://stream-processing-systems.github.io/en/course/fundamentals/keeping-each-orders-story-together/

In our grocery service, a processor keeps the store's
[list of orders waiting for a customer's answer](https://stream-processing-systems.github.io/en/course/fundamentals/when-one-event-is-not-enough.md).
It remembers whether an order is waiting: for your order `ord-1042`, yes after
the proposal at 10:04 and no after your acceptance at 10:06. But the store
handles many orders at once. The red apples have run out, so at 10:05 a picker
working on another order, `ord-1337`, also proposes green apples instead. That
event arrives between the proposal for your order and your answer.

Events from both orders come from one source, mixed together. When your
acceptance arrives, the processor must take your order off the list and leave
`ord-1337` on it. How does it keep each order's memory apart, and how does it
find the right memory for each event?

## Memory for each order

One remembered yes or no cannot describe two orders. If the processor kept a
single answer for the whole store, your acceptance at 10:06 would set it to no,
and `ord-1337` would leave the list while its shopper is still deciding.

So the processor keeps a separate answer for each order, like a small table
with one row per order. When an event arrives, the processor reads its
`order_id`, finds that order's row, and changes only that row.[^1] The value
that decides which memory an event belongs to is called the **key**. Here the
key is `order_id`.

![Each event changes only the row for its key](diagrams/state-by-key.svg)

Keeping memory per key does not require several machines or a special product.
One small program can keep a row for every order that is still in progress.

## Two orders, one flow

Here is how the events of both orders arrive and what the processor remembers
after each one:

| Time | Event | Key | `ord-1042` waiting? | `ord-1337` waiting? |
| --- | --- | --- | --- | --- |
| 10:04 | `replacement_proposed` | `ord-1042` | Yes | No |
| 10:05 | `replacement_proposed` | `ord-1337` | Yes | Yes |
| 10:06 | `replacement_accepted` | `ord-1042` | No | Yes |
| 10:08 | `replacement_accepted` | `ord-1337` | No | No |

At 10:06, the processor changes only the row for `ord-1042`, and `ord-1337`
stays on the list. The events of one order do not have to arrive together.
Each event carries its key, and the key leads the processor back to the right
memory, however many events from other orders came in between.

## Choosing the key

Every event carries several IDs, and each would group events differently. The
[event ID](https://stream-processing-systems.github.io/en/course/fundamentals/what-an-event-tells-us.md) names one record, the order ID connects
the records of one order, and the store ID connects all orders at one store.
Here is what each choice would do to the waiting list:

| Key | Events that share memory | Result |
| --- | --- | --- |
| `event_id` | None: each event has its own row | Your acceptance cannot reach the yes that the proposal left, so your order stays on the list |
| `store_id` | All events of all orders at `store-418` | Your acceptance sets the store's answer to no and takes `ord-1337` off the list too |
| `order_id` | All events of one order | Each order's answer changes only with its own events |

The right key depends on the question. "Is this order waiting?" is about one
order, so the key is `order_id`. "How many orders at this store are waiting?"
is about the store, so its key is `store_id`, and its memory is a count. That
count goes up when an order joins the list and down when an order leaves it.
One system can answer both questions, each with its own key.

The key also has to tell different things apart. In our service, every order ID
is unique across all stores. If each store numbered its own orders, two stores
could both have an order `ord-1042`, and their events would share one row. The
key would then have to combine two fields: `store_id` and `order_id` together.

## What the key does not settle

The key decides which memory an event changes. It does not decide the order in
which events arrive. [Records can arrive in a different order](https://stream-processing-systems.github.io/en/course/fundamentals/what-an-event-tells-us.md)
from the actions they describe. If the proposal from 10:04 is delayed, your
acceptance from 10:06 can reach the processor first. Both events still go to
the row for `ord-1042`. The acceptance sets it to no, which it already was.
Then the late proposal sets it to yes, and your order joins the list after you
have answered. Store staff now see the picker waiting for an answer you have
already given.

The events carry the times when things happened: 10:04 for the proposal, 10:06
for the acceptance. One approach is to hold incoming events and apply them in
the order they happened, using those times instead of the arrival order. But how
long should the processor hold them, when an earlier event may still be on its
way?

## What to remember

- A key is the value that decides which events belong together and which memory
  an event changes.
- The processor keeps separate state for each key, so events from many orders
  can arrive mixed together without mixing their memory.
- The key follows the question: per order, per store, or a combination of
  fields when one field does not tell things apart.
- A key keeps each order's events together, but it does not put them in the
  order they happened.

## References

[^1]: [Apache Flink 2.3: Keyed State](https://nightlies.apache.org/flink/flink-docs-release-2.3/docs/concepts/stateful-stream-processing/#keyed-state).
