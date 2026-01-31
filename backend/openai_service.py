"""
Gemini-powered AI Presentation Agent.
Autonomous slide presenter with voice interaction support.
"""

import os
import logging
import google.generativeai as genai
from slides import get_slides_context, get_slide_count, get_slide, get_current_topic

logger = logging.getLogger(__name__)

# Configure Gemini
genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))


def get_presenter_prompt():
    """Generate the presenter prompt with current slide context."""
    topic = get_current_topic() or "the presentation topic"
    slide_count = get_slide_count() or 6

    return f"""You are an AI presentation agent delivering a 1:1 presentation about {topic}.
You are speaking directly to ONE person, not an audience. Use "you" not "everyone" or "audience".
You have {slide_count} slides to present.

{get_slides_context()}

IMPORTANT BEHAVIORS:
1. When presenting a slide, give a natural, engaging explanation. Don't just read bullet points.
2. When answering a question, ALWAYS determine which slide is most relevant and navigate to it.
3. Speak directly and personally - this is a 1:1 conversation.
4. After answering a question, briefly mention you'll continue from that slide.

You MUST use the go_to_slide function whenever:
- The person asks a question about a specific topic (go to the relevant slide)
- They ask to see something specific
- The content being discussed matches a different slide better
"""


def get_slide_tools():
    """Get the slide navigation tools with current slide count."""
    slide_count = get_slide_count() or 6
    return [
        genai.protos.Tool(
            function_declarations=[
                genai.protos.FunctionDeclaration(
                    name="go_to_slide",
                    description="Navigate to the most relevant slide. ALWAYS use this when answering questions to show the relevant content.",
                    parameters=genai.protos.Schema(
                        type=genai.protos.Type.OBJECT,
                        properties={
                            "slide_number": genai.protos.Schema(
                                type=genai.protos.Type.INTEGER,
                                description=f"The slide number (1-{slide_count}) most relevant to the topic"
                            )
                        },
                        required=["slide_number"]
                    )
                )
            ]
        )
    ]


def get_qa_model():
    """Get the Q&A model with current context."""
    return genai.GenerativeModel(
        model_name="models/gemini-2.5-flash",
        tools=get_slide_tools(),
        system_instruction=get_presenter_prompt()
    )


# Model for narration (doesn't need dynamic tools)
narration_model = genai.GenerativeModel(
    model_name="models/gemini-2.5-flash",
    system_instruction="""You are an engaging presentation narrator giving a 1:1 presentation.
Speak directly to the person (use "you", not "everyone" or "audience").
Generate detailed, thorough narrations of 75-100 words per slide.
Be natural, conversational, and personal while providing substantive explanations."""
)


async def generate_slide_narration(slide_id: int) -> dict:
    """
    Generate narration for a slide. Used for automatic presentation.
    Returns dict with narration text and next slide number.
    """
    slide = get_slide(slide_id)
    total_slides = get_slide_count()
    topic = get_current_topic() or "this topic"

    if not slide:
        logger.warning(f"Slide {slide_id} not found")
        return {
            "narration": "Slide not found.",
            "current_slide": slide_id,
            "has_next": False
        }

    content_list = "\n".join(f"- {point}" for point in slide.get('content', []))

    # Customize prompt based on slide position - 1:1 tone
    if slide_id == 1:
        intro = f"This is the opening slide about {topic}. Welcome the person warmly, introduce the topic, and let them know what they'll learn today."
    elif slide_id == total_slides:
        intro = "This is the final slide. Summarize the key takeaways, wrap up thoughtfully, and thank them for their time."
    else:
        intro = f"This is slide {slide_id} of {total_slides}. Present it thoroughly with good explanations and context."

    prompt = f"""{intro}

Title: {slide.get('title', 'Untitled')}
Content:
{content_list}

Speaker Notes: {slide.get('speaker_notes', '')}

Generate an engaging narration of 75-100 words. Speak directly to the person (use "you", not "everyone").
Expand on each point with examples or context. Be conversational and explain concepts clearly - don't just read bullet points.
Make sure to cover all the key points on the slide."""

    try:
        logger.info(f"Generating narration for slide {slide_id}")
        response = await narration_model.generate_content_async(prompt)

        if response and response.text:
            return {
                "narration": response.text,
                "current_slide": slide_id,
                "has_next": slide_id < total_slides,
                "next_slide": slide_id + 1 if slide_id < total_slides else None
            }
        else:
            return {
                "narration": f"Let me tell you about {slide.get('title', 'this topic')}.",
                "current_slide": slide_id,
                "has_next": slide_id < total_slides,
                "next_slide": slide_id + 1 if slide_id < total_slides else None
            }
    except Exception as e:
        logger.error(f"Error generating narration: {e}", exc_info=True)
        return {
            "narration": f"Let me tell you about {slide.get('title', 'this topic')}.",
            "current_slide": slide_id,
            "has_next": slide_id < total_slides,
            "next_slide": slide_id + 1 if slide_id < total_slides else None
        }


async def handle_question(question: str, current_slide: int) -> dict:
    """
    Handle a user question. Determines the most relevant slide and generates a response.
    No chat history - each question is handled independently.
    """
    total_slides = get_slide_count()
    topic = get_current_topic() or "the presentation"

    prompt = f"""[Currently on slide {current_slide} of {total_slides}]
[Presentation topic: {topic}]

The person asks: "{question}"

Answer this question thoroughly in 100-125 words. Speak directly to them (use "you", not "audience").
Provide a detailed, helpful explanation with examples if relevant.
IMPORTANT: Use go_to_slide to navigate to the most relevant slide for this question before answering."""

    try:
        logger.info(f"Handling question: {question}")

        # Get fresh model with current context
        qa_model = get_qa_model()

        # Single message, no history needed
        response = qa_model.generate_content(prompt)

        result = {
            "response": "",
            "target_slide": current_slide,  # Default to current
            "slide_changed": False
        }

        # Check for function calls
        if response.candidates and response.candidates[0].content.parts:
            for part in response.candidates[0].content.parts:
                # Check for function call
                if hasattr(part, 'function_call') and part.function_call:
                    fc = part.function_call
                    if fc.name == "go_to_slide":
                        slide_num = int(fc.args.get("slide_number", current_slide))
                        slide_num = max(1, min(slide_num, total_slides))
                        result["target_slide"] = slide_num
                        result["slide_changed"] = slide_num != current_slide

                        # Get the text response after function call
                        # Send function result back to get text
                        chat = qa_model.start_chat()
                        chat.send_message(prompt)
                        func_response = chat.send_message(
                            genai.protos.Content(
                                parts=[genai.protos.Part(
                                    function_response=genai.protos.FunctionResponse(
                                        name="go_to_slide",
                                        response={"result": f"Navigated to slide {slide_num}"}
                                    )
                                )]
                            )
                        )
                        result["response"] = func_response.text
                        return result

                # Get text response
                elif hasattr(part, 'text') and part.text:
                    result["response"] = part.text

        if not result["response"]:
            result["response"] = response.text if response.text else "I'm not sure how to answer that. Let me continue with the presentation."

        return result

    except Exception as e:
        logger.error(f"Error handling question: {e}", exc_info=True)
        return {
            "response": "I encountered an error processing your question. Let me continue with the presentation.",
            "target_slide": current_slide,
            "slide_changed": False
        }
