---
name: vertical-slice
description: >
  Apply vertical slice architecture to organize code by feature instead of by
  technical layer. Use when adding a new feature, endpoint, command, query, or
  use case. Use when deciding whether to create new files or edit existing ones.
  Use when implementing CQRS, mediator pattern, plugin architecture, event-driven
  patterns, or auto-discovery registration. Use when the user asks about additive
  architecture, feature folders, or minimizing edit surface. Also trigger when you
  notice yourself about to add a new method to an existing controller or service —
  that is the moment this skill is most needed.
---

# Vertical Slice Architecture

## Golden Rule

> **Prefer creating new files that plug into the system over editing existing files.**

Vertical Slice Architecture (VSA) organizes code around features and use cases, not technical layers. Each "slice" is a self-contained unit that owns its entire feature vertically — from the API endpoint through validation, business logic, and data access.

The key insight: **new features should be additions, not modifications.** When you add a feature, you create a new folder with new files. You do not open an existing controller and add another method. You do not grow a shared service class. The system discovers your new slice automatically.

This makes development additive: fewer merge conflicts, smaller blast radius per change, and each feature independently testable and deletable.

---

## Decision Framework

Before implementing any requirement, walk through this decision tree:

### Step 1: Is this a NEW use case, feature, or endpoint?

**YES** → Create a new slice: a new folder with its own handler, request, response, validator, and endpoint files. **STOP.**

### Step 2: Is this a VARIANT of an existing feature?

Different input shape, output format, or business rules — but same domain.

**YES** → Create a new slice that shares domain types/interfaces with the original but has its own handler. Do not add conditional branches to the existing handler. **STOP.**

### Step 3: Is this a CROSS-CUTTING concern?

Logging, validation, authorization, caching, rate limiting, error handling, transactions.

**YES** → Implement as middleware, pipeline behavior, or decorator. These are new files that wrap all handlers uniformly. Do not edit individual slices. **STOP.**

### Step 4: Is this a BUG FIX in existing behavior?

**YES** → Edit the existing slice's handler. This is the correct case for modifying an existing file. **STOP.**

### Step 5: Is this extending an existing feature with a side effect?

E.g., "when an order is created, also send a confirmation email."

**YES** → Use the Observer/Domain Events pattern: publish an event from the existing slice (if it doesn't already), then handle the extension in a **NEW file** that subscribes to that event. The existing slice changes minimally (one line to emit the event) or not at all. **STOP.**

### Step 6: None of the above?

Edit the existing file as a last resort. But first, consider whether the requirement reveals a missing abstraction that would make this additive in the future.

### Red Flags

You are about to modify a file you probably should not if:

- You are adding a new `if/elif/else` or `switch/case` branch for a **different use case**
- You are adding an **unrelated method** to a controller or service class
- You are importing new domain-specific dependencies into a **shared module**
- The file's import list is growing past **15 imports**
- Your PR touches **more than 3 existing files** for a single new feature
- You are adding a new route to a file that already has **5+ routes**

When you notice a red flag, stop and ask: "Should this be a new slice instead?"

---

## Slice Anatomy

A vertical slice is a folder containing everything for one use case:

```
features/
  orders/
    create_order/
      command.ext          # Input DTO / request shape
      handler.ext          # Business logic
      response.ext         # Output DTO
      validator.ext        # Input validation rules
      endpoint.ext         # HTTP/API wiring (route, method, status codes)
      handler_test.ext     # Tests for this slice
    get_order/
      query.ext
      handler.ext
      response.ext
      endpoint.ext
      handler_test.ext
    cancel_order/
      ...
  users/
    register_user/
      ...
    get_user_profile/
      ...
```

### The Anti-Pattern (Layered Architecture)

```
controllers/
  order_controller.ext     ← grows with every order feature
services/
  order_service.ext        ← grows with every order feature
validators/
  order_validator.ext      ← grows with every order feature
repositories/
  order_repository.ext     ← grows with every order feature
```

In this structure, adding "cancel order" means editing 4 existing files across 4 directories. In the vertical slice structure, it means creating 1 new folder with its own files — zero existing files touched.

### When a Slice Can Be Simpler

Not every slice needs all files. A simple query might be just:

```
get_order/
  handler.ext      # query + handler + response in one file
  endpoint.ext
```

Match complexity to the use case. The principle is isolation, not ceremony.

---

## Auto-Discovery Registration

The vertical slice pattern only works if new files are **automatically discovered** by the system. If adding a new slice requires editing a central registration file, you've just moved the coupling problem.

### Convention-Based Scanning

The system scans directories and registers everything matching a convention:

- **Python**: `pkgutil.walk_packages()` or `importlib` to scan `features/` and import all handler modules. Importing triggers decorator registration.
- **C#**: `AddMediatR(cfg => cfg.RegisterServicesFromAssembly(...))` scans the assembly for all `IRequestHandler<>` implementations.
- **TypeScript**: `fs.readdirSync()` on the features directory, dynamically importing each module's `register()` function. Or barrel files (`index.ts`) that re-export.

### Decorator/Attribute Registration

Handlers self-register via decorators or attributes:

- **Python**: `@handles(CreateOrderCommand)` decorator registers the handler in a global registry
- **C#**: `IRequestHandler<CreateOrderCommand, CreateOrderResponse>` — MediatR discovers by interface
- **TypeScript**: `@Handler(CreateOrderCommand)` decorator or manual `mediator.register()` in the module

### Plugin Discovery

For larger systems, features are plugins discovered at startup:

- **Python**: `entry_points` in `pyproject.toml`, or directory scanning with `importlib`
- **C#**: MEF `[Export]`/`[Import]` attributes, or `AssemblyLoadContext` for dynamic loading
- **TypeScript**: Dynamic `import()` with directory scanning, or package.json workspaces

**The test**: after creating a new slice, you should be able to run the app and see the new endpoint/feature work **without editing any other file**. If you can't, your discovery mechanism needs fixing.

See language-specific reference files for complete implementations:
- [references/python.md](references/python.md)
- [references/csharp.md](references/csharp.md)
- [references/typescript.md](references/typescript.md)

---

## Enabling Patterns

Two patterns make vertical slices composable without coupling. For deep dives with pseudocode and decision matrices, see [references/patterns.md](references/patterns.md).

### Plugin Context Pattern

The core system provides a **context object** (app instance, service registry, router) to each plugin/feature module at startup. Each module registers its own routes, handlers, and dependencies through this context. The host system never knows what plugins exist — it just provides the registration surface.

**Use when:**
- Features need to register routes, handlers, or services at startup
- You want new features to be truly zero-edit additions
- The system should be extensible by third parties or separate teams
- You need runtime feature toggling (load/unload plugins)

**The key file**: A `register(context)` or `init_app(app)` function in each feature module.

### Observer / Domain Events Pattern

Slices communicate through **events** — immutable facts about what happened ("order created", "user registered"). The publishing slice emits an event. Any number of subscribing slices react to it in their own handler files. The publisher never knows who subscribes.

**Use when:**
- Feature A's action should trigger behavior in Feature B
- You want to add reactions to existing events without editing the emitter
- Side effects (email, audit log, analytics) should be separate from core logic
- Multiple independent systems need to react to the same trigger

**The key principle**: New reaction = new subscriber file. The publisher stays unchanged.

### Mediator Pattern

A dispatcher sits between the caller and the handler. The caller sends a request object; the mediator routes it to the correct handler. Neither knows about the other directly. The mediator discovers handlers automatically (assembly scanning, decorator registry, convention).

**Use when:**
- You want CQRS (commands and queries as separate slices)
- Cross-cutting concerns should be applied uniformly via pipeline behaviors
- The API layer should not depend on business logic implementations

---

## Language Quick Start

### Python (FastAPI)

New feature = new folder under `features/`:

```
features/orders/create_order/
  __init__.py
  command.py       # CreateOrderCommand dataclass
  handler.py       # handle(cmd) -> response
  response.py      # CreateOrderResponse dataclass
  endpoint.py      # @router.post("/orders")
  test_handler.py  # pytest
```

Auto-discovery: `features/__init__.py` uses `pkgutil.walk_packages()` to import all modules. Each endpoint module defines a `router` that gets included by the app.

For complete mediator, event bus, and plugin context implementations: [references/python.md](references/python.md)

### C# (ASP.NET Core + MediatR)

New feature = new folder under `Features/`:

```
Features/Orders/CreateOrder/
  CreateOrderCommand.cs     # IRequest<CreateOrderResponse>
  CreateOrderHandler.cs     # IRequestHandler<,>
  CreateOrderResponse.cs    # response record
  CreateOrderValidator.cs   # AbstractValidator<>
  CreateOrderEndpoint.cs    # app.MapPost(...)
  CreateOrderTests.cs       # xUnit
```

Auto-discovery: `builder.Services.AddMediatR(cfg => cfg.RegisterServicesFromAssembly(...))` finds all handlers. Minimal API endpoints register via a `IEndpointDefinition` convention.

For complete pipeline behaviors, domain events, and project structure: [references/csharp.md](references/csharp.md)

### TypeScript (Express / React)

**Backend** — new feature = new folder under `features/`:

```
features/orders/create-order/
  command.ts        # CreateOrderCommand type + Zod schema
  handler.ts        # handleCreateOrder(cmd) -> response
  response.ts       # CreateOrderResponse type
  endpoint.ts       # express Router with POST /orders
  handler.test.ts   # vitest/jest
```

**Frontend (React)** — new feature = new folder under `features/`:

```
features/orders/create-order/
  use-create-order.ts       # React hook
  create-order-form.tsx     # Component
  create-order.api.ts       # API call
  create-order.schema.ts    # Zod validation
  create-order.test.tsx     # Test
```

Auto-discovery: features index scans directories and collects routers/registrations.

For complete mediator, event bus, and plugin registration implementations: [references/typescript.md](references/typescript.md)

---

## Execution Notes

### When Generating New Code

1. **Create the slice folder first**, then create each constituent file
2. Each file should have a single clear responsibility
3. Ensure the auto-discovery mechanism will find the new slice — verify by checking the registration pattern
4. Write the test file alongside the handler, not as an afterthought

### When Reviewing Existing Code

Flag these violations for the user:
- Controllers with more than 5 action methods → suggest splitting into endpoint-per-file
- Service classes with more than 300 lines → suggest extracting into per-feature handlers
- A single PR modifying more than 5 existing files for one feature → suggest vertical slice refactor

### When NOT to Refactor

- **Do not rewrite existing working code** into vertical slices unless the user explicitly asks for a refactor
- **Do not split a file** that is small, focused, and only serves one use case
- **Do not add ceremony** (separate request/response files) when a simple function will do
- Apply vertical slices to **new features going forward**, not retroactively to everything

### Testing

Each slice is independently testable:
- Test the handler directly by calling it with a request object — no HTTP server needed
- Mock only external dependencies (database, external APIs), not other slices
- If testing a slice requires importing from another slice, that's a coupling smell
