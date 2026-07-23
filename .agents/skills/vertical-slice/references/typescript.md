# TypeScript Vertical Slice Patterns

## Table of Contents

1. [Slice Folder Template](#slice-folder-template)
2. [Simple Mediator with Auto-Discovery](#simple-mediator-with-auto-discovery)
3. [Typed Event Bus](#typed-event-bus)
4. [Plugin Registration for Express/Fastify](#plugin-registration-for-expressfastify)
5. [React Feature Slices](#react-feature-slices)
6. [Barrel Files with Glob Discovery](#barrel-files-with-glob-discovery)
7. [Cross-Cutting Middleware Factories](#cross-cutting-middleware-factories)

---

## Slice Folder Template

### Backend (Express / Fastify)

```
src/
  features/
    index.ts                        # Auto-discovers and registers all features
    orders/
      create-order/
        command.ts                  # CreateOrderCommand type + Zod schema
        handler.ts                  # handleCreateOrder(cmd) -> response
        response.ts                 # CreateOrderResponse type
        endpoint.ts                 # Express Router with POST /orders
        handler.test.ts             # vitest / jest tests
      get-order/
        query.ts
        handler.ts
        response.ts
        endpoint.ts
        handler.test.ts
    users/
      register-user/
        ...
  shared/
    mediator.ts                     # Mediator implementation
    event-bus.ts                    # EventBus implementation
    middleware/
      validation.ts                 # Zod validation middleware factory
      logging.ts                    # Request logging middleware
  app.ts                            # Express app — registers features
```

### Frontend (React)

```
src/
  features/
    orders/
      create-order/
        use-create-order.ts         # React hook
        create-order-form.tsx       # Component
        create-order.api.ts         # API call function
        create-order.schema.ts      # Zod validation schema
        create-order.test.tsx       # Component test
      order-list/
        use-orders.ts
        order-list.tsx
        orders.api.ts
        order-list.test.tsx
    users/
      ...
  shared/
    event-bus.ts
    api-client.ts
```

---

## Simple Mediator with Auto-Discovery

```typescript
// shared/mediator.ts
type Handler<TRequest = unknown, TResponse = unknown> = (
  request: TRequest
) => Promise<TResponse>;

const handlers = new Map<string, Handler>();

export function registerHandler<TRequest, TResponse>(
  commandName: string,
  handler: Handler<TRequest, TResponse>
): void {
  handlers.set(commandName, handler as Handler);
}

export async function send<TResponse>(
  commandName: string,
  request: unknown
): Promise<TResponse> {
  const handler = handlers.get(commandName);
  if (!handler) {
    throw new Error(`No handler registered for "${commandName}"`);
  }
  return handler(request) as Promise<TResponse>;
}
```

```typescript
// features/orders/create-order/command.ts
import { z } from "zod";

export const createOrderSchema = z.object({
  customerId: z.string().min(1),
  items: z.array(
    z.object({
      sku: z.string().min(1),
      quantity: z.number().int().positive(),
    })
  ).min(1),
  total: z.number().positive(),
});

export type CreateOrderCommand = z.infer<typeof createOrderSchema>;
```

```typescript
// features/orders/create-order/handler.ts
import { registerHandler } from "../../../shared/mediator";
import { publish } from "../../../shared/event-bus";
import type { CreateOrderCommand } from "./command";
import type { CreateOrderResponse } from "./response";

async function handleCreateOrder(
  cmd: CreateOrderCommand
): Promise<CreateOrderResponse> {
  const order = await saveOrderToDb(cmd);

  await publish("order.created", {
    orderId: order.id,
    customerId: cmd.customerId,
    total: cmd.total,
  });

  return { orderId: order.id, status: "created" };
}

// Self-registration — importing this module registers the handler
registerHandler("create-order", handleCreateOrder);
```

### Auto-Discovery via Directory Scan

```typescript
// features/index.ts
import { readdirSync, statSync } from "fs";
import { join } from "path";

export async function discoverFeatures(): Promise<void> {
  const featuresDir = __dirname;

  for (const domain of readdirSync(featuresDir)) {
    const domainPath = join(featuresDir, domain);
    if (!statSync(domainPath).isDirectory() || domain === "index.ts") continue;

    for (const slice of readdirSync(domainPath)) {
      const slicePath = join(domainPath, slice);
      if (!statSync(slicePath).isDirectory()) continue;

      const handlerPath = join(slicePath, "handler");
      try {
        await import(handlerPath); // Triggers registerHandler() calls
      } catch {
        // No handler in this directory — skip
      }
    }
  }
}
```

---

## Typed Event Bus

```typescript
// shared/event-bus.ts
type EventHandler<T = unknown> = (payload: T) => Promise<void> | void;

const subscribers = new Map<string, Set<EventHandler>>();

export function subscribe<T>(
  eventName: string,
  handler: EventHandler<T>
): () => void {
  const handlers = subscribers.get(eventName) ?? new Set();
  handlers.add(handler as EventHandler);
  subscribers.set(eventName, handlers);

  // Return unsubscribe function
  return () => {
    handlers.delete(handler as EventHandler);
  };
}

export async function publish<T>(eventName: string, payload: T): Promise<void> {
  const handlers = subscribers.get(eventName);
  if (!handlers) return;

  const promises = [...handlers].map((handler) => handler(payload));
  await Promise.all(promises);
}
```

```typescript
// Strongly typed event map (optional but recommended)
// shared/events.ts
export interface EventMap {
  "order.created": { orderId: string; customerId: string; total: number };
  "order.cancelled": { orderId: string; reason: string };
  "user.registered": { userId: string; email: string };
}

// Type-safe wrappers
export function onEvent<K extends keyof EventMap>(
  event: K,
  handler: EventHandler<EventMap[K]>
): () => void {
  return subscribe(event, handler);
}

export function emitEvent<K extends keyof EventMap>(
  event: K,
  payload: EventMap[K]
): Promise<void> {
  return publish(event, payload);
}
```

```typescript
// features/notifications/on-order-created-send-email.ts  ← NEW FILE
import { onEvent } from "../../shared/events";

onEvent("order.created", async (event) => {
  await emailService.send({
    to: event.customerId,
    subject: `Order ${event.orderId} confirmed`,
    body: `Your order for $${event.total} has been placed.`,
  });
});
```

```typescript
// features/analytics/on-order-created-track.ts  ← ANOTHER NEW FILE
import { onEvent } from "../../shared/events";

onEvent("order.created", async (event) => {
  analytics.track("order_created", {
    orderId: event.orderId,
    total: event.total,
  });
});
```

Each new reaction = new file. The publisher never changes.

---

## Plugin Registration for Express/Fastify

```typescript
// shared/plugin.ts
import type { Express, Router } from "express";

export interface PluginContext {
  app: Express;
  registerRouter(prefix: string, router: Router): void;
}

export interface FeaturePlugin {
  name: string;
  register(ctx: PluginContext): void;
}
```

```typescript
// features/orders/index.ts
import type { PluginContext } from "../../shared/plugin";
import { createOrderRouter } from "./create-order/endpoint";
import { getOrderRouter } from "./get-order/endpoint";

export function register(ctx: PluginContext): void {
  ctx.registerRouter("/api/orders", createOrderRouter);
  ctx.registerRouter("/api/orders", getOrderRouter);
}
```

```typescript
// features/orders/create-order/endpoint.ts
import { Router } from "express";
import { send } from "../../../shared/mediator";
import { createOrderSchema } from "./command";
import { validate } from "../../../shared/middleware/validation";

export const createOrderRouter = Router();

createOrderRouter.post(
  "/",
  validate(createOrderSchema),
  async (req, res) => {
    const result = await send("create-order", req.body);
    res.status(201).json(result);
  }
);
```

```typescript
// app.ts
import express from "express";
import { readdirSync, statSync } from "fs";
import { join } from "path";
import type { PluginContext } from "./shared/plugin";
import { discoverFeatures } from "./features";

const app = express();
app.use(express.json());

// Plugin context
const ctx: PluginContext = {
  app,
  registerRouter(prefix, router) {
    app.use(prefix, router);
  },
};

// Auto-discover feature plugins
const featuresDir = join(__dirname, "features");
for (const name of readdirSync(featuresDir)) {
  const featurePath = join(featuresDir, name);
  if (!statSync(featurePath).isDirectory()) continue;

  try {
    const mod = require(join(featurePath, "index"));
    if (typeof mod.register === "function") {
      mod.register(ctx);
    }
  } catch {
    // Not a plugin directory — skip
  }
}

// Discover handlers (triggers self-registration)
await discoverFeatures();

app.listen(3000);
```

Adding a new feature domain = new folder with `index.ts` containing `register()`. `app.ts` never changes.

---

## React Feature Slices

Each feature is a self-contained folder with its own hook, component, API function, schema, and test.

```typescript
// features/orders/create-order/create-order.schema.ts
import { z } from "zod";

export const createOrderSchema = z.object({
  customerId: z.string().min(1, "Customer ID is required"),
  items: z.array(
    z.object({
      sku: z.string().min(1),
      quantity: z.number().int().positive(),
    })
  ).min(1, "At least one item is required"),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
```

```typescript
// features/orders/create-order/create-order.api.ts
import type { CreateOrderInput } from "./create-order.schema";

export interface CreateOrderResult {
  orderId: string;
  status: string;
}

export async function createOrder(
  input: CreateOrderInput
): Promise<CreateOrderResult> {
  const response = await fetch("/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error("Failed to create order");
  return response.json();
}
```

```typescript
// features/orders/create-order/use-create-order.ts
import { useState, useCallback } from "react";
import { createOrder, type CreateOrderResult } from "./create-order.api";
import { createOrderSchema, type CreateOrderInput } from "./create-order.schema";

export function useCreateOrder() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateOrderResult | null>(null);

  const submit = useCallback(async (input: CreateOrderInput) => {
    setIsLoading(true);
    setError(null);
    try {
      const validated = createOrderSchema.parse(input);
      const response = await createOrder(validated);
      setResult(response);
      return response;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { submit, isLoading, error, result };
}
```

```tsx
// features/orders/create-order/create-order-form.tsx
import { useCreateOrder } from "./use-create-order";
import type { CreateOrderInput } from "./create-order.schema";

export function CreateOrderForm() {
  const { submit, isLoading, error } = useCreateOrder();

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const input: CreateOrderInput = {
      customerId: formData.get("customerId") as string,
      items: [{ sku: formData.get("sku") as string, quantity: 1 }],
    };
    await submit(input);
  };

  return (
    <form onSubmit={handleSubmit}>
      <input name="customerId" placeholder="Customer ID" required />
      <input name="sku" placeholder="Product SKU" required />
      <button type="submit" disabled={isLoading}>
        {isLoading ? "Creating..." : "Create Order"}
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
```

```tsx
// features/orders/create-order/create-order.test.tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CreateOrderForm } from "./create-order-form";
import * as api from "./create-order.api";

vi.mock("./create-order.api");

describe("CreateOrderForm", () => {
  it("submits the form and shows loading state", async () => {
    const mockCreate = vi.mocked(api.createOrder);
    mockCreate.mockResolvedValue({ orderId: "ord-123", status: "created" });

    render(<CreateOrderForm />);

    fireEvent.change(screen.getByPlaceholderText("Customer ID"), {
      target: { value: "cust-456" },
    });
    fireEvent.change(screen.getByPlaceholderText("Product SKU"), {
      target: { value: "WIDGET-1" },
    });
    fireEvent.click(screen.getByText("Create Order"));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith({
        customerId: "cust-456",
        items: [{ sku: "WIDGET-1", quantity: 1 }],
      });
    });
  });

  it("shows error message on failure", async () => {
    vi.mocked(api.createOrder).mockRejectedValue(new Error("Network error"));

    render(<CreateOrderForm />);

    fireEvent.change(screen.getByPlaceholderText("Customer ID"), {
      target: { value: "cust-456" },
    });
    fireEvent.change(screen.getByPlaceholderText("Product SKU"), {
      target: { value: "WIDGET-1" },
    });
    fireEvent.click(screen.getByText("Create Order"));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Network error");
    });
  });
});
```

Adding a new feature (e.g., "cancel order") = new folder with its own hook, component, API, schema, and test. Zero edits to existing features.

---

## Barrel Files with Glob Discovery

```typescript
// features/orders/index.ts — barrel file for the orders domain
export { CreateOrderForm } from "./create-order/create-order-form";
export { useCreateOrder } from "./create-order/use-create-order";
export { OrderList } from "./order-list/order-list";
export { useOrders } from "./order-list/use-orders";

// When you add cancel-order, just add one more export line here:
// export { CancelOrderButton } from "./cancel-order/cancel-order-button";
```

For truly zero-edit discovery (backend), use dynamic imports:

```typescript
// features/index.ts — auto-discovers all feature modules
import { readdirSync, statSync, existsSync } from "fs";
import { join } from "path";
import type { Router } from "express";

export async function collectRouters(): Promise<Array<{ prefix: string; router: Router }>> {
  const routers: Array<{ prefix: string; router: Router }> = [];
  const featuresDir = __dirname;

  for (const domain of readdirSync(featuresDir)) {
    const domainPath = join(featuresDir, domain);
    if (!statSync(domainPath).isDirectory()) continue;

    for (const slice of readdirSync(domainPath)) {
      const endpointPath = join(domainPath, slice, "endpoint");
      if (!existsSync(endpointPath + ".ts") && !existsSync(endpointPath + ".js")) continue;

      const mod = await import(endpointPath);
      if (mod.router) {
        const prefix = `/api/${domain}`;
        routers.push({ prefix, router: mod.router });
      }
    }
  }

  return routers;
}
```

---

## Cross-Cutting Middleware Factories

Middleware factories are new files that wrap endpoints uniformly. Adding a new concern = adding a new factory file.

```typescript
// shared/middleware/validation.ts
import type { Request, Response, NextFunction } from "express";
import type { ZodSchema } from "zod";

export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: "Validation failed",
        details: result.error.flatten().fieldErrors,
      });
      return;
    }
    req.body = result.data;
    next();
  };
}
```

```typescript
// shared/middleware/logging.ts
import type { Request, Response, NextFunction } from "express";

export function requestLogger() {
  return (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on("finish", () => {
      const duration = Date.now() - start;
      console.log(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
    });
    next();
  };
}
```

```typescript
// shared/middleware/error-handler.ts
import type { Request, Response, NextFunction } from "express";

export function errorHandler() {
  return (err: Error, req: Request, res: Response, _next: NextFunction) => {
    console.error(`Error in ${req.method} ${req.path}:`, err.message);
    res.status(500).json({ error: "Internal server error" });
  };
}
```

Each middleware is a separate file. Endpoints opt in by adding the middleware to their router chain — no structural changes to the endpoint logic.
