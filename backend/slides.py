"""
Dynamic slide generation and management for AI presentation.
Slides are generated based on user-provided topics.
"""

import json
import logging
import google.generativeai as genai
import os

logger = logging.getLogger(__name__)

# Configure Gemini
genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))

# Model for slide generation
slide_generator = genai.GenerativeModel(
    model_name="models/gemini-2.5-flash-lite",
    system_instruction="""You are an expert presentation creator. Generate clear, well-structured presentation slides.
Always respond with valid JSON only, no markdown or extra text."""
)


class SlideState:
    """Manages the current presentation state."""

    def __init__(self):
        self.topic = ""
        self.slides = []

    def set_slides(self, topic: str, slides: list):
        self.topic = topic
        self.slides = slides

    def clear(self):
        self.topic = ""
        self.slides = []


# Global state
slide_state = SlideState()


async def generate_slides_for_topic(topic: str, num_slides: int = 6) -> list:
    """
    Generate presentation slides for a given topic using Gemini.
    Returns a list of slide dictionaries.
    """
    prompt = f"""Create a {num_slides}-slide presentation about: "{topic}"

This is for a 1:1 presentation (presenter speaking directly to one person).

Generate exactly {num_slides} slides with this JSON structure:
[
  {{
    "id": 1,
    "title": "Slide Title",
    "content": ["Point 1", "Point 2", "Point 3", "Point 4"],
    "speaker_notes": "Detailed notes for the presenter about what to say for this slide (2-3 sentences)"
  }}
]

Requirements:
- Slide 1: Introduction to the topic
- Slides 2-{num_slides-1}: Core content with 3-5 bullet points each
- Slide {num_slides}: Summary and wrap-up
- Make content clear and educational
- Speaker notes should be conversational and personal (speaking to "you" not "audience")

Return ONLY the JSON array, no other text."""

    try:
        logger.info(f"Generating {num_slides} slides for topic: {topic}")
        response = await slide_generator.generate_content_async(prompt)

        if response and response.text:
            # Clean up response - remove markdown code blocks if present
            text = response.text.strip()
            if text.startswith("```json"):
                text = text[7:]
            if text.startswith("```"):
                text = text[3:]
            if text.endswith("```"):
                text = text[:-3]
            text = text.strip()

            slides = json.loads(text)

            # Validate and fix slide IDs
            for i, slide in enumerate(slides):
                slide["id"] = i + 1

            slide_state.set_slides(topic, slides)
            logger.info(f"Successfully generated {len(slides)} slides")
            return slides
        else:
            raise ValueError("Empty response from Gemini")

    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse slides JSON: {e}")
        raise ValueError(f"Failed to generate valid slides: {e}")
    except Exception as e:
        logger.error(f"Error generating slides: {e}", exc_info=True)
        raise


def get_all_slides():
    """Return all slides."""
    return slide_state.slides


def get_slide(slide_id: int):
    """Return a specific slide by ID (1-indexed)."""
    if slide_state.slides and 1 <= slide_id <= len(slide_state.slides):
        return slide_state.slides[slide_id - 1]
    return None


def get_slide_count():
    """Return total number of slides."""
    return len(slide_state.slides)


def get_current_topic():
    """Return the current presentation topic."""
    return slide_state.topic


def has_slides():
    """Check if slides have been generated."""
    return len(slide_state.slides) > 0


def get_slides_context():
    """Return a summary of all slides for AI context."""
    if not slide_state.slides:
        return "No slides available."

    context = f"Presentation topic: {slide_state.topic}\n"
    context += "Presentation slides:\n"
    for slide in slide_state.slides:
        context += f"\nSlide {slide['id']}: {slide['title']}\n"
        for point in slide.get('content', []):
            context += f"  - {point}\n"
    return context
