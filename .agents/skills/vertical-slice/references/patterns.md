# Enabling Patterns for Vertical Slices

## Table of Contents

1. [Plugin Context Pattern](#plugin-context-pattern)
2. [Observer / Domain Events Pattern](#observer--domain-events-pattern)
3. [Pattern Combination Guide](#pattern-combination-guide)

---

## Plugin Context Pattern

### Problem

You have a core system that needs to support new features over time. Every time you add a feature, you have to edit the core — adding routes, registering services, wiring dependencies. The core grows, becomes fragile, and every team's changes conflict.

### Core Concepts

| Concept | Role |
|---------|------|
| **Host** | The core system that provides extension points but does not know about plugins |
| **Plugin Interface** | A contract (interface, protocol, abstract class) that plugins must implement |
| **Plugin Context** | An object the host gives to each plugin — access to the router, service registry, config, event bus |
| **Discovery Mechanism** | How the host finds plugins — directory scan, entry points, assembly scan, config file |

### How It Works

```
# Pseudocode

# 1. Host defines the context and plugin contract
class PluginContext:
    router: Router
    services: ServiceRegistry
    config: Config
    events: EventBus

interface Plugin:
    name: string
    register(context: PluginContext) -> void

# 2. Host discovers and initializes plugins
plugins = discover_plugins("./features/")
for plugin in plugins:
    plugin.register(context)

# 3. Each plugin registers itself — host code never changes
class OrderPlugin implements Plugin:
    name = "orders"
    register(ctx):
        ctx.router.add_route("POST", "/orders", create_order_handler)
        ctx.router.add_route("GET", "/orders/:id", get_order_handler)
        ctx.events.subscribe("payment.completed", on_payment_completed)
```

### Key Properties

- **Host is closed for modification**: adding a new plugin never requires editing host code
- **Plugins are self-contained**: each plugin brings its own routes, handlers, services, and event subscriptions
- **Discovery is automatic**: the host finds plugins by scanning a directory, reading entry points, or scanning assemblies
- **Context provides boundaries**: plugins can only do what the context allows — this is a security and API stability boundary

### When to Use

- The system will grow with many independent features over time
- Multiple teams work on the same codebase and need isolation
- You want runtime feature toggling (enable/disable features without code changes)
- Third-party extensibility is a requirement (like VS Code extensions)

### When NOT to Use

- Small applications with fewer than 5 features — the overhead exceeds the benefit
- Tightly coupled features that share significant state — forced isolation creates more duplication than value
- Performance-critical paths where the indirection of plugin dispatch matters

---

## Observer / Domain Events Pattern

### Problem

Feature A does something (creates an order), and Feature B needs to react (send a confirmation email). If A calls B directly, they're coupled — A must know about B, import B's code, and change whenever B's interface changes. Worse, when Feature C also needs to react (update analytics), you have to edit A again.

### Core Concepts

| Concept | Role |
|---------|------|
| **Event** | An immutable fact about what happened — a data class with a name and payload |
| **Publisher** | The slice that emits an event after performing an action |
| **Subscriber** | A handler in a separate file that reacts to an event |
| **Event Bus / Dispatcher** | Routes events to subscribers — the decoupling layer |

### How It Works

```
# Pseudocode

# 1. Define events as immutable data
class OrderCreated:
    order_id: string
    customer_id: string
    total: decimal
    created_at: datetime

# 2. Publisher emits the event (one line added to existing handler)
class CreateOrderHandler:
    handle(command):
        order = create_the_order(command)
        self.events.publish(OrderCreated(order.id, order.customer_id, order.total, now()))
        return order

# 3. Subscribers are SEPARATE FILES — one per reaction
# File: features/notifications/on_order_created_send_email.ext
class SendOrderConfirmationEmail:
    handles: OrderCreated
    handle(event):
        send_email(event.customer_id, "Your order {event.order_id} is confirmed")

# File: features/analytics/on_order_created_track.ext
class TrackOrderAnalytics:
    handles: OrderCreated
    handle(event):
        analytics.track("order_created", amount=event.total)
```

### The "New Reaction = New File" Principle

This is the key insight for additive architecture:

| Action | Files Created | Files Modified |
|--------|--------------|----------------|
| Add email notification on order creation | 1 (new subscriber) | 0 |
| Add analytics tracking on order creation | 1 (new subscriber) | 0 |
| Add audit logging on order creation | 1 (new subscriber) | 0 |
| Add inventory reservation on order creation | 1 (new subscriber) | 0 |

The publisher (`CreateOrderHandler`) is written once. Every new reaction is a new file. The publisher never changes, no matter how many subscribers exist.

### Deferred vs Immediate Dispatch

- **Immediate**: Event handlers run synchronously within the same request. Use for critical side effects that must succeed with the main action (e.g., audit logging).
- **Deferred**: Events are collected during the request and dispatched after the main action commits. Use for side effects that can tolerate slight delay (e.g., email, analytics).
- **Async/External**: Events are published to a message broker (Kafka, RabbitMQ) for cross-service reactions. Use when subscribers are in different services.

### When to Use

- One action triggers reactions in multiple independent features
- You want to add reactions to existing actions without editing the actor
- Side effects (email, audit, analytics, cache invalidation) should be decoupled from core logic
- Features owned by different teams need to react to the same trigger

### When NOT to Use

- The reaction is core to the action (not a side effect) — e.g., "calculate tax" is part of creating an order, not a reaction to it
- There is exactly one consumer and it will never change — direct method call is simpler
- The reaction must happen before the action completes and its failure should abort the action — use direct calls with error handling instead

---

## Pattern Combination Guide

### Plugin Context + Observer

Plugins subscribe to host events during registration. This is the most powerful combination for extensibility:

```
# Plugin registers its event subscriptions via the context
class NotificationPlugin:
    register(ctx):
        ctx.events.subscribe(OrderCreated, self.send_confirmation)
        ctx.events.subscribe(OrderCancelled, self.send_cancellation)
```

New plugin = new file with event subscriptions. Host never changes. Events flow automatically.

### Mediator + Observer (CQRS Pattern)

Commands flow through the mediator to a single handler (1:1). Events flow through the event bus to multiple subscribers (1:N).

```
# Command: 1 sender → mediator → 1 handler
mediator.send(CreateOrderCommand(...))
  → CreateOrderHandler.handle()
    → emits OrderCreated event

# Event: 1 publisher → event bus → N subscribers
event_bus.publish(OrderCreated(...))
  → SendConfirmationEmail.handle()
  → UpdateAnalytics.handle()
  → ReserveInventory.handle()
```

Use the mediator for the primary action (command/query). Use events for side effects that fan out.

### Decision Matrix

| Scenario | Pattern | New Feature Impact |
|----------|---------|-------------------|
| New API endpoint / use case | **Mediator + Vertical Slice** | New folder with handler, endpoint, etc. |
| New side effect on existing action | **Observer / Domain Events** | New subscriber file |
| New independently deployable feature | **Plugin Context** | New plugin module |
| Cross-cutting behavior (logging, auth) | **Pipeline Behavior / Middleware** | New middleware file |
| New data query with different shape | **CQRS + Mediator** | New query + handler files |
| Feature that reacts to multiple events | **Observer + Plugin** | New plugin subscribing to multiple events |
