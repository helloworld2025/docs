# People Beta rollout

Status: People is a regular Beta feature. It is no longer gated by Lab.

## Shipped scope

- People is visible in Beta and remains controlled by the user-facing People switch.
- A contact identity stays scoped to its App. The same visible name can be linked to the
  same People object in multiple Apps without leaking recognition across Apps.
- New-contact recommendations and likely cross-App identities use separate evidence
  thresholds. Confirmed-send day counts are tracked separately from observation days.
- The communication preset catalog includes common China and international messaging
  Apps and web clients. The catalog is a cold-start aid, not the intended long-term
  discovery architecture.
- Visual-context copy states that a screenshot is sent to the selected model with the
  request and is not stored locally by Relay.

There is no external Lab-user migration requirement for this rollout. Before this
promotion, Lab was only used internally.

## Deferred: reliable visual fallback after weak local signals

Current behavior treats any non-empty window-title or top-band AX text as sufficient
local evidence. At request time, a non-empty `pinnedChatPartnerSignals` array prevents
the contact-recognition screenshot fallback, even when the strings are generic UI noise
such as `Chats`, `Search`, or a timestamp.

Future direction:

- distinguish an exact local contact match from weak contextual strings;
- let weak strings accompany the screenshot instead of suppressing it;
- preserve the global visual-context switch, the per-scene explicit opt-out, and the
  AI-conversation exclusion;
- add true-device coverage for local-match, weak-signal, screenshot-fallback, and
  permission-denied paths.

This rollout intentionally does not change the fallback condition.

## Deferred: capability-based communication-scene discovery

Unknown-contact discovery currently depends on built-in human-communication scene IDs.
That means an unlisted messaging App needs a preset update or a user-created mapping
before it participates in discovery.

Future direction:

- add semantic scene capabilities such as `humanMessaging`, rather than checking fixed
  scene IDs;
- combine local UI evidence (editable composer, message list, send affordance, contact
  header) with an on-demand visual classification when local evidence is inconclusive;
- persist a locally learned App/domain classification after repeated evidence or user
  confirmation;
- expose a user override for marking any App or website as human communication;
- retain the static catalog only as a cold-start accelerator.

This rollout only expands the verified preset catalog; it does not implement automatic
scene classification.

