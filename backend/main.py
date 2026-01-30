"""
FastAPI backend for AI Voice Slide Presentation App (using Gemini).
"""

import os
from typing import Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
from logging_config import setup_logging
import logging

# 1. Setup the whole project
setup_logging()
logger = logging.getLogger(__name__)

load_dotenv()

from slides import get_all_slides, get_slide, get_slide_count
import openai_service


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Application starting up...")
    yield
    print("Shutting down...")


app = FastAPI(title="AI Slide Presentation", lifespan=lifespan)

# CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============== Models ==============

class ChatRequest(BaseModel):
    message: str
    conversation_history: list = []
    current_slide: int = 1


class ChatResponse(BaseModel):
    response: str
    slide_action: Optional[dict] = None
    new_slide: int


# ============== State Management ==============

class PresentationState:
    """Manages the state of active presentations."""

    def __init__(self):
        self.current_slide = 1
        self.conversation_history = []
        self.is_speaking = False
        self.interrupt_flag = False

    def reset(self):
        self.current_slide = 1
        self.conversation_history = []
        self.is_speaking = False
        self.interrupt_flag = False


presentation_state = PresentationState()


# ============== REST Endpoints ==============

@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "model": "gemini-1.5-flash"}


@app.get("/api/slides")
async def get_slides():
    """Get all slides."""
    return {
        "slides": get_all_slides(),
        "total": get_slide_count()
    }


@app.get("/api/slides/{slide_id}")
async def get_slide_by_id(slide_id: int):
    """Get a specific slide by ID."""
    slide = get_slide(slide_id)
    if not slide:
        raise HTTPException(status_code=404, detail="Slide not found")
    return slide


@app.get("/api/state")
async def get_state():
    """Get current presentation state."""
    return {
        "current_slide": presentation_state.current_slide,
        "is_speaking": presentation_state.is_speaking,
        "total_slides": get_slide_count()
    }


@app.post("/api/reset")
async def reset_presentation():
    """Reset the presentation to initial state."""
    presentation_state.reset()
    return {"status": "reset", "current_slide": 1}


@app.post("/api/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """Process user message and get AI response with optional slide navigation."""
    try:
        result = await openai_service.generate_response(
            user_message=request.message,
            conversation_history=request.conversation_history,
            current_slide=request.current_slide
        )

        # Calculate new slide based on action
        new_slide = request.current_slide
        if result["slide_action"]:
            action = result["slide_action"]
            if action["action"] == "go_to":
                new_slide = max(1, min(action["slide_number"], get_slide_count()))
            elif action["action"] == "next":
                new_slide = min(request.current_slide + 1, get_slide_count())
            elif action["action"] == "previous":
                new_slide = max(request.current_slide - 1, 1)

        # Update global state
        presentation_state.current_slide = new_slide
        presentation_state.conversation_history = request.conversation_history + [
            {"role": "user", "content": request.message},
            {"role": "assistant", "content": result["response"]}
        ]

        return ChatResponse(
            response=result["response"],
            slide_action=result["slide_action"],
            new_slide=new_slide
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/narrate/{slide_id}")
async def get_slide_narration(slide_id: int):
    """Get AI-generated narration for a slide."""
    try:
        narration = await openai_service.generate_slide_narration(slide_id)
        return {"narration": narration, "slide_id": slide_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============== WebSocket ==============

class ConnectionManager:
    """Manages WebSocket connections."""

    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except:
                pass


manager = ConnectionManager()


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket for real-time communication and interruption."""
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_json()
            message_type = data.get("type")

            if message_type == "interrupt":
                presentation_state.interrupt_flag = True
                presentation_state.is_speaking = False
                await websocket.send_json({
                    "type": "interrupt_ack",
                    "message": "Interruption acknowledged"
                })

            elif message_type == "slide_update":
                slide_number = data.get("slide_number", 1)
                presentation_state.current_slide = slide_number
                await manager.broadcast({
                    "type": "slide_changed",
                    "slide_number": slide_number
                })

            elif message_type == "speaking_start":
                presentation_state.is_speaking = True
                presentation_state.interrupt_flag = False
                await manager.broadcast({
                    "type": "speaking_status",
                    "is_speaking": True
                })

            elif message_type == "speaking_end":
                presentation_state.is_speaking = False
                await manager.broadcast({
                    "type": "speaking_status",
                    "is_speaking": False
                })

            elif message_type == "ping":
                await websocket.send_json({"type": "pong"})

    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        print(f"WebSocket error: {e}")
        manager.disconnect(websocket)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
