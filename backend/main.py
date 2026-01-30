"""
FastAPI backend for AI Voice Presentation Agent.
The agent autonomously presents slides and responds to voice interruptions.
"""

import os
import logging
from typing import Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
from logging_config import setup_logging

setup_logging()
logger = logging.getLogger(__name__)

load_dotenv()

from slides import (
    get_all_slides, get_slide, get_slide_count,
    generate_slides_for_topic, has_slides, get_current_topic
)
import openai_service as agent_service


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("AI Presentation Agent starting...")
    yield
    logger.info("Shutting down...")


app = FastAPI(title="AI Presentation Agent", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============== Models ==============

class TopicRequest(BaseModel):
    topic: str
    num_slides: int = 6


class QuestionRequest(BaseModel):
    question: str
    current_slide: int = 1


class PresentResponse(BaseModel):
    narration: str
    current_slide: int
    has_next: bool
    next_slide: Optional[int] = None


class QuestionResponse(BaseModel):
    response: str
    target_slide: int
    slide_changed: bool


# ============== Agent State ==============

class AgentState:
    """Simple state for the presenting agent."""

    def __init__(self):
        self.current_slide = 1
        self.is_presenting = False
        self.is_speaking = False

    def reset(self):
        self.current_slide = 1
        self.is_presenting = False
        self.is_speaking = False


agent_state = AgentState()


# ============== REST Endpoints ==============

@app.get("/api/health")
async def health_check():
    return {"status": "healthy", "agent": "gemini-presentation-agent"}


# ============== Topic & Slide Generation ==============

@app.post("/api/topic")
async def set_topic(request: TopicRequest):
    """
    Set the presentation topic and generate slides.
    Must be called before starting the presentation.
    """
    if not request.topic.strip():
        raise HTTPException(status_code=400, detail="Topic cannot be empty")

    try:
        logger.info(f"Generating slides for topic: {request.topic}")
        slides = await generate_slides_for_topic(request.topic, request.num_slides)
        agent_state.reset()

        return {
            "status": "success",
            "topic": request.topic,
            "slides": slides,
            "total": len(slides)
        }
    except Exception as e:
        logger.error(f"Failed to generate slides: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate slides: {str(e)}")


@app.get("/api/topic")
async def get_topic():
    """Get the current presentation topic."""
    topic = get_current_topic()
    return {
        "topic": topic,
        "has_slides": has_slides()
    }


@app.get("/api/slides")
async def get_slides():
    """Get all slides for display."""
    return {
        "slides": get_all_slides(),
        "total": get_slide_count()
    }


@app.get("/api/slides/{slide_id}")
async def get_slide_by_id(slide_id: int):
    """Get a specific slide."""
    slide = get_slide(slide_id)
    if not slide:
        raise HTTPException(status_code=404, detail="Slide not found")
    return slide


@app.post("/api/reset")
async def reset_agent():
    """Reset the agent to start fresh."""
    agent_state.reset()
    return {"status": "reset", "current_slide": 1}


# ============== Agent Presentation Endpoints ==============

@app.get("/api/present/start", response_model=PresentResponse)
async def start_presentation():
    """
    Start the presentation from slide 1.
    Returns the first slide's narration.
    """
    if not has_slides():
        raise HTTPException(
            status_code=400,
            detail="No slides available. Please set a topic first using POST /api/topic"
        )

    agent_state.current_slide = 1
    agent_state.is_presenting = True

    result = await agent_service.generate_slide_narration(1)

    return PresentResponse(
        narration=result["narration"],
        current_slide=result["current_slide"],
        has_next=result["has_next"],
        next_slide=result.get("next_slide")
    )


@app.get("/api/present/slide/{slide_id}", response_model=PresentResponse)
async def present_slide(slide_id: int):
    """
    Present a specific slide.
    Used after answering questions to continue from that slide.
    """
    if slide_id < 1 or slide_id > get_slide_count():
        raise HTTPException(status_code=404, detail="Slide not found")

    agent_state.current_slide = slide_id
    result = await agent_service.generate_slide_narration(slide_id)

    return PresentResponse(
        narration=result["narration"],
        current_slide=result["current_slide"],
        has_next=result["has_next"],
        next_slide=result.get("next_slide")
    )


@app.get("/api/present/next", response_model=PresentResponse)
async def present_next_slide():
    """
    Advance to and present the next slide.
    Called automatically when current slide narration finishes.
    """
    next_slide = agent_state.current_slide + 1
    total = get_slide_count()

    if next_slide > total:
        # Presentation complete
        return PresentResponse(
            narration="That brings us to the end of the presentation. Thank you for your time today! If you have any questions about what we covered, feel free to ask.",
            current_slide=total,
            has_next=False,
            next_slide=None
        )

    agent_state.current_slide = next_slide
    result = await agent_service.generate_slide_narration(next_slide)

    return PresentResponse(
        narration=result["narration"],
        current_slide=result["current_slide"],
        has_next=result["has_next"],
        next_slide=result.get("next_slide")
    )


@app.post("/api/question", response_model=QuestionResponse)
async def handle_question(request: QuestionRequest):
    """
    Handle a user question/interruption.
    Finds the most relevant slide and generates a response.
    """
    logger.info(f"User question: {request.question}")

    result = await agent_service.handle_question(
        question=request.question,
        current_slide=request.current_slide
    )

    # Update agent state
    agent_state.current_slide = result["target_slide"]

    return QuestionResponse(
        response=result["response"],
        target_slide=result["target_slide"],
        slide_changed=result["slide_changed"]
    )


# ============== WebSocket for Real-time Control ==============

class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for conn in self.active_connections:
            try:
                await conn.send_json(message)
            except:
                pass


manager = ConnectionManager()


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    WebSocket for real-time events:
    - interrupt: User wants to stop/interrupt
    - speaking_start/end: TTS status updates
    - slide_changed: Notify of slide changes
    """
    await manager.connect(websocket)
    logger.info("WebSocket client connected")

    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            if msg_type == "interrupt":
                agent_state.is_speaking = False
                await websocket.send_json({
                    "type": "interrupt_ack",
                    "current_slide": agent_state.current_slide
                })

            elif msg_type == "speaking_start":
                agent_state.is_speaking = True

            elif msg_type == "speaking_end":
                agent_state.is_speaking = False

            elif msg_type == "slide_update":
                slide_num = data.get("slide_number", 1)
                agent_state.current_slide = slide_num
                await manager.broadcast({
                    "type": "slide_changed",
                    "slide_number": slide_num
                })

            elif msg_type == "ping":
                await websocket.send_json({"type": "pong"})

    except WebSocketDisconnect:
        manager.disconnect(websocket)
        logger.info("WebSocket client disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        manager.disconnect(websocket)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
