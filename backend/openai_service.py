"""
Gemini service for AI chat with function calling for slide navigation.
"""

import os
import google.generativeai as genai
import logging
from slides import get_slides_context, get_slide_count, get_slide

logger = logging.getLogger(__name__)
# Configure Gemini
genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))

# Function declarations for slide control (Gemini format)
SLIDE_TOOLS = [
    genai.protos.Tool(
        function_declarations=[
            genai.protos.FunctionDeclaration(
                name="go_to_slide",
                description="Navigate to a specific slide number. Use this when the user asks to go to a particular slide or when you want to jump to a relevant slide based on the conversation.",
                parameters=genai.protos.Schema(
                    type=genai.protos.Type.OBJECT,
                    properties={
                        "slide_number": genai.protos.Schema(
                            type=genai.protos.Type.INTEGER,
                            description=f"The slide number to navigate to (1-{get_slide_count()})"
                        )
                    },
                    required=["slide_number"]
                )
            ),
            genai.protos.FunctionDeclaration(
                name="next_slide",
                description="Move to the next slide in the presentation. Use this when continuing the presentation flow or when the user asks to move forward.",
                parameters=genai.protos.Schema(
                    type=genai.protos.Type.OBJECT,
                    properties={}
                )
            ),
            genai.protos.FunctionDeclaration(
                name="previous_slide",
                description="Go back to the previous slide. Use this when the user wants to revisit the previous content.",
                parameters=genai.protos.Schema(
                    type=genai.protos.Type.OBJECT,
                    properties={}
                )
            )
        ]
    )
]

SYSTEM_PROMPT = f"""You are an AI presentation assistant delivering a presentation about Machine Learning.
You have {get_slide_count()} slides to present.

{get_slides_context()}

Your role:
1. Present each slide clearly and engagingly when asked to start or continue
2. Answer questions from the audience naturally
3. Use the slide navigation functions when appropriate:
   - Move to next slide when you've finished presenting the current one
   - Jump to a specific slide if a question relates to that topic
   - Go back if the user wants to revisit something
4. Keep responses conversational and concise (2-4 sentences typically)
5. If asked about the current slide, refer to the slide content you're presenting

Always respond in a natural, presenter-like manner. You're speaking to an audience, so be engaging but professional."""

# Create the model
model = genai.GenerativeModel(
    model_name="gemini-1.5-flash",
    tools=SLIDE_TOOLS,
    system_instruction=SYSTEM_PROMPT
)


async def generate_response(
    user_message: str,
    conversation_history: list,
    current_slide: int
) -> dict:
    """
    Generate a response using Gemini with function calling for slide navigation.

    Returns:
        dict with keys:
        - response: str (the AI's text response)
        - slide_action: dict or None (slide navigation action if any)
    """
    result = {
        "response": "",
        "slide_action": None
    }

    # Build conversation for Gemini
    # Convert OpenAI-style history to Gemini format
    gemini_history = []
    for msg in conversation_history:
        role = "user" if msg["role"] == "user" else "model"
        gemini_history.append({
            "role": role,
            "parts": [msg["content"]]
        })

    # Create chat session with history
    chat = model.start_chat(history=gemini_history)

    # Add context about current slide to the message
    context_message = f"[Current slide: {current_slide}]\n\nUser: {user_message}"

    # Generate response
    response = chat.send_message(context_message)

    # Check for function calls
    if response.candidates[0].content.parts:
        for part in response.candidates[0].content.parts:
            if hasattr(part, 'function_call') and part.function_call:
                fc = part.function_call
                function_name = fc.name

                if function_name == "go_to_slide":
                    slide_num = fc.args.get("slide_number", 1)
                    result["slide_action"] = {
                        "action": "go_to",
                        "slide_number": int(slide_num)
                    }
                elif function_name == "next_slide":
                    result["slide_action"] = {
                        "action": "next"
                    }
                elif function_name == "previous_slide":
                    result["slide_action"] = {
                        "action": "previous"
                    }

                # Send function response back to get the text reply
                func_response = chat.send_message(
                    genai.protos.Content(
                        parts=[genai.protos.Part(
                            function_response=genai.protos.FunctionResponse(
                                name=function_name,
                                response={"result": f"Slide navigation executed: {function_name}"}
                            )
                        )]
                    )
                )
                result["response"] = func_response.text
                return result

            elif hasattr(part, 'text') and part.text:
                result["response"] = part.text

    if not result["response"]:
        result["response"] = response.text

    return result


async def generate_slide_narration(slide_id: int) -> str:
    """Generate narration for a specific slide with error handling."""
    slide = get_slide(slide_id)
    
    if not slide:
        logger.warning(f"Slide with ID {slide_id} not found.")
        return "Slide not found."

    # Preparing the prompt
    content_list = "\n".join(f"- {point}" for point in slide.get('content', []))
    prompt = f"""Generate a brief, engaging narration for this slide:

Title: {slide.get('title', 'Untitled')}
Content:
{content_list}

Speaker Notes: {slide.get('speaker_notes', '')}

Keep it conversational and under 30 seconds. Don't read bullet points verbatim."""

    try:
        # Log the attempt and the prompt length
        logger.info(f"Attempting to generate narration for slide {slide_id}...")
        
        narration_model = genai.GenerativeModel(
            model_name="gemini-1.5-flash",
            system_instruction="You are an engaging presentation narrator."
        )

        # Making the API call
        response = await narration_model.generate_content_async(prompt)
        
        # Verify if the response actually contains text
        if response and response.text:
            logger.info(f"Successfully generated narration for slide {slide_id}.")
            return response.text
        else:
            logger.error("Model returned an empty response (possibly blocked by safety filters).")
            return "Narration could not be generated due to content restrictions."

    except Exception as e:
        # This catches API errors, timeouts, or network issues
        logger.error(f"Error during model generation for slide {slide_id}: {str(e)}", exc_info=True)
        return "An error occurred while generating the narration."