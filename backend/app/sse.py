"""
app/sse.py — Simple in-process SSE broadcaster.

Usage (backend):
    from app.sse import sse
    await sse.broadcast(course_id, {"type": "lesson_ready", ...})

Usage (endpoint):
    return StreamingResponse(sse.subscribe(course_id), media_type="text/event-stream")
"""
import asyncio
import json
import logging
from collections import defaultdict
from typing import AsyncGenerator

logger = logging.getLogger(__name__)


class SSEBroadcaster:
    def __init__(self):
        # course_id → list of subscriber queues
        self._queues: dict[str, list[asyncio.Queue]] = defaultdict(list)
        # Buffer recent events so clients that connect slightly late still get them
        self._history: dict[str, list[str]] = defaultdict(list)

    async def subscribe(self, course_id: str) -> AsyncGenerator[str, None]:
        """Async generator yielding SSE-formatted strings."""
        queue: asyncio.Queue = asyncio.Queue()

        # Replay history to catch up if pipeline already emitted events
        for event in self._history.get(course_id, []):
            await queue.put(event)

        self._queues[course_id].append(queue)
        try:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=20.0)
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
                    continue

                if event is None:  # sentinel — pipeline done
                    break
                yield event
        finally:
            queues = self._queues.get(course_id, [])
            if queue in queues:
                queues.remove(queue)

    async def broadcast(self, course_id: str, data: dict) -> None:
        """Broadcast a JSON event to all subscribers of this course_id."""
        line = f"data: {json.dumps(data)}\n\n"
        self._history[course_id].append(line)
        for queue in list(self._queues.get(course_id, [])):
            await queue.put(line)

    async def close(self, course_id: str) -> None:
        """Send sentinel to all subscribers and clean up history."""
        for queue in list(self._queues.get(course_id, [])):
            await queue.put(None)
        self._history.pop(course_id, None)


# Module-level singleton
sse = SSEBroadcaster()
