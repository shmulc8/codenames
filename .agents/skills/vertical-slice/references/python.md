# Python Vertical Slice Patterns

## Table of Contents

1. [Slice Folder Template](#slice-folder-template)
2. [Simple Mediator with Auto-Discovery](#simple-mediator-with-auto-discovery)
3. [Auto-Discovery Convention](#auto-discovery-convention)
4. [Typed Event Bus](#typed-event-bus)
5. [Plugin Context with FastAPI](#plugin-context-with-fastapi)
6. [Cross-Cutting with Decorators](#cross-cutting-with-decorators)
7. [Testing a Slice in Isolation](#testing-a-slice-in-isolation)

---

## Slice Folder Template

```
app/
  features/
    __init__.py              # Auto-discovery: imports all feature modules
    orders/
      __init__.py
      create_order/
        __init__.py
        command.py           # CreateOrderCommand dataclass
        handler.py           # handle(cmd) -> CreateOrderResponse
        response.py          # CreateOrderResponse dataclass
        validator.py         # validate(cmd) -> raises ValidationError
        endpoint.py          # FastAPI router with POST /orders
        test_handler.py      # pytest tests
      get_order/
        __init__.py
        query.py
        handler.py
        response.py
        endpoint.py
        test_handler.py
    users/
      __init__.py
      register_user/
        ...
  shared/
    event_bus.py             # EventBus implementation
    mediator.py              # Mediator implementation
    middleware.py             # Cross-cutting pipeline behaviors
  main.py                    # App entry point — registers features
```

---

## Simple Mediator with Auto-Discovery

```python
# shared/mediator.py
from dataclasses import dataclass
from typing import Any, Callable, TypeVar, get_type_hints

T = TypeVar("T")

_handlers: dict[type, Callable] = {}


def handles(command_type: type):
    """Decorator that registers a handler for a command type."""
    def decorator(fn: Callable) -> Callable:
        _handlers[command_type] = fn
        return fn
    return decorator


async def send(command: Any) -> Any:
    """Dispatch a command to its registered handler."""
    handler = _handlers.get(type(command))
    if handler is None:
        raise ValueError(f"No handler registered for {type(command).__name__}")
    return await handler(command)
```

```python
# features/orders/create_order/command.py
from dataclasses import dataclass

@dataclass(frozen=True)
class CreateOrderCommand:
    customer_id: str
    items: list[dict]
    total: float
```

```python
# features/orders/create_order/handler.py
from shared.mediator import handles
from shared.event_bus import publish
from .command import CreateOrderCommand
from .response import CreateOrderResponse

@handles(CreateOrderCommand)
async def handle_create_order(cmd: CreateOrderCommand) -> CreateOrderResponse:
    order = await save_order_to_db(cmd)
    await publish(OrderCreated(order_id=order.id, customer_id=cmd.customer_id))
    return CreateOrderResponse(order_id=order.id, status="created")
```

---

## Auto-Discovery Convention

```python
# features/__init__.py
import importlib
import pkgutil
from pathlib import Path

def discover_features():
    """Import all feature modules, triggering @handles decorator registration."""
    package_dir = Path(__file__).parent
    for importer, module_name, is_pkg in pkgutil.walk_packages(
        path=[str(package_dir)],
        prefix=f"{__package__}.",
    ):
        importlib.import_module(module_name)
```

```python
# main.py
from fastapi import FastAPI
from features import discover_features
from features.orders.create_order.endpoint import router as create_order_router
# ... or use the plugin context pattern below to auto-register routers too

app = FastAPI()
discover_features()  # All @handles decorators fire, mediator is populated
```

---

## Typed Event Bus

```python
# shared/event_bus.py
from dataclasses import dataclass
from typing import Any, Callable

_subscribers: dict[type, list[Callable]] = {}


def subscribe(event_type: type):
    """Decorator that subscribes a handler to an event type."""
    def decorator(fn: Callable) -> Callable:
        _subscribers.setdefault(event_type, []).append(fn)
        return fn
    return decorator


async def publish(event: Any) -> None:
    """Publish an event to all subscribers."""
    handlers = _subscribers.get(type(event), [])
    for handler in handlers:
        await handler(event)
```

```python
# features/orders/create_order/handler.py (event emission)
from shared.event_bus import publish

@dataclass(frozen=True)
class OrderCreated:
    order_id: str
    customer_id: str
    total: float
```

```python
# features/notifications/on_order_created_send_email.py  ← NEW FILE, no edits elsewhere
from shared.event_bus import subscribe
from features.orders.create_order.handler import OrderCreated

@subscribe(OrderCreated)
async def send_order_confirmation(event: OrderCreated) -> None:
    await email_service.send(
        to=event.customer_id,
        subject=f"Order {event.order_id} confirmed",
        body=f"Your order for ${event.total} has been placed.",
    )
```

```python
# features/analytics/on_order_created_track.py  ← ANOTHER NEW FILE
from shared.event_bus import subscribe
from features.orders.create_order.handler import OrderCreated

@subscribe(OrderCreated)
async def track_order_analytics(event: OrderCreated) -> None:
    analytics.track("order_created", {"order_id": event.order_id, "total": event.total})
```

Adding each new reaction is a new file. The `CreateOrderHandler` never changes.

---

## Plugin Context with FastAPI

```python
# shared/plugin.py
from dataclasses import dataclass, field
from typing import Protocol
from fastapi import FastAPI

@dataclass
class PluginContext:
    app: FastAPI
    _routers: list = field(default_factory=list)

    def include_router(self, router, **kwargs):
        self._routers.append((router, kwargs))

    def apply(self):
        for router, kwargs in self._routers:
            self.app.include_router(router, **kwargs)


class Feature(Protocol):
    def register(self, ctx: PluginContext) -> None: ...
```

```python
# features/orders/__init__.py
from shared.plugin import PluginContext
from .create_order.endpoint import router as create_order_router
from .get_order.endpoint import router as get_order_router

def register(ctx: PluginContext) -> None:
    ctx.include_router(create_order_router, prefix="/orders", tags=["orders"])
    ctx.include_router(get_order_router, prefix="/orders", tags=["orders"])
```

```python
# main.py
from fastapi import FastAPI
from shared.plugin import PluginContext
from features import discover_features
import importlib
import pkgutil
from pathlib import Path

app = FastAPI()
ctx = PluginContext(app=app)

# Auto-discover and register all feature modules
features_dir = Path("features")
for importer, name, is_pkg in pkgutil.iter_modules([str(features_dir)]):
    if is_pkg:
        module = importlib.import_module(f"features.{name}")
        if hasattr(module, "register"):
            module.register(ctx)

ctx.apply()
discover_features()  # Trigger handler registrations
```

Adding a new feature domain (e.g., `features/payments/`) only requires creating the folder with a `register()` function. `main.py` never changes.

---

## Cross-Cutting with Decorators

```python
# shared/middleware.py
import functools
import logging
import time
from typing import Callable, TypeVar

T = TypeVar("T")
logger = logging.getLogger(__name__)


def with_logging(fn: Callable) -> Callable:
    """Log entry, exit, and duration of handler execution."""
    @functools.wraps(fn)
    async def wrapper(*args, **kwargs):
        name = fn.__qualname__
        logger.info(f"Handling {name}")
        start = time.monotonic()
        result = await fn(*args, **kwargs)
        duration = time.monotonic() - start
        logger.info(f"Handled {name} in {duration:.3f}s")
        return result
    return wrapper


def with_validation(validator_fn: Callable):
    """Validate the command before passing to handler."""
    def decorator(fn: Callable) -> Callable:
        @functools.wraps(fn)
        async def wrapper(cmd, *args, **kwargs):
            validator_fn(cmd)  # Raises ValidationError on failure
            return await fn(cmd, *args, **kwargs)
        return wrapper
    return decorator
```

```python
# features/orders/create_order/handler.py
from shared.mediator import handles
from shared.middleware import with_logging, with_validation
from .command import CreateOrderCommand
from .validator import validate_create_order

@handles(CreateOrderCommand)
@with_logging
@with_validation(validate_create_order)
async def handle_create_order(cmd: CreateOrderCommand) -> CreateOrderResponse:
    ...
```

New cross-cutting concerns = new decorator functions in `shared/middleware.py`. Individual handlers opt in by adding a decorator line — no structural changes.

---

## Testing a Slice in Isolation

```python
# features/orders/create_order/test_handler.py
import pytest
from unittest.mock import AsyncMock, patch
from .command import CreateOrderCommand
from .handler import handle_create_order
from .response import CreateOrderResponse


@pytest.fixture
def sample_command():
    return CreateOrderCommand(
        customer_id="cust-123",
        items=[{"sku": "WIDGET-1", "qty": 2}],
        total=49.99,
    )


async def test_create_order_returns_response(sample_command):
    with patch("features.orders.create_order.handler.save_order_to_db") as mock_save:
        mock_save.return_value = type("Order", (), {"id": "ord-456"})()
        with patch("features.orders.create_order.handler.publish") as mock_publish:
            result = await handle_create_order(sample_command)

    assert isinstance(result, CreateOrderResponse)
    assert result.order_id == "ord-456"
    assert result.status == "created"
    mock_publish.assert_called_once()


async def test_create_order_publishes_event(sample_command):
    with patch("features.orders.create_order.handler.save_order_to_db") as mock_save:
        mock_save.return_value = type("Order", (), {"id": "ord-456"})()
        with patch("features.orders.create_order.handler.publish") as mock_publish:
            await handle_create_order(sample_command)

    event = mock_publish.call_args[0][0]
    assert event.order_id == "ord-456"
    assert event.customer_id == "cust-123"
```

The handler is tested directly — no HTTP server, no middleware, no other slices. External dependencies (database, event bus) are mocked at the boundary.
