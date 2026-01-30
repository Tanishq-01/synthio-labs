"""
Slide content for the AI presentation.
Topic: Introduction to Machine Learning
"""

SLIDES = [
    {
        "id": 1,
        "title": "Introduction to Machine Learning",
        "content": [
            "What is Machine Learning?",
            "A subset of Artificial Intelligence",
            "Systems that learn and improve from experience",
            "Without being explicitly programmed"
        ],
        "speaker_notes": "Welcome everyone! Today we'll explore the fascinating world of Machine Learning. ML is a branch of AI that enables computers to learn from data and improve their performance over time."
    },
    {
        "id": 2,
        "title": "Types of Machine Learning",
        "content": [
            "Supervised Learning - learns from labeled data",
            "Unsupervised Learning - finds hidden patterns",
            "Reinforcement Learning - learns through trial and error"
        ],
        "speaker_notes": "There are three main types of machine learning. Supervised learning uses labeled examples, like teaching with answer keys. Unsupervised learning discovers patterns on its own. Reinforcement learning learns by receiving rewards or penalties."
    },
    {
        "id": 3,
        "title": "Real-World Applications",
        "content": [
            "Recommendation Systems (Netflix, Spotify)",
            "Voice Assistants (Siri, Alexa)",
            "Self-Driving Cars",
            "Medical Diagnosis",
            "Fraud Detection"
        ],
        "speaker_notes": "Machine learning is everywhere! From the shows Netflix recommends to voice assistants understanding your speech. Self-driving cars use ML to navigate, doctors use it to diagnose diseases, and banks use it to detect fraud."
    },
    {
        "id": 4,
        "title": "Key Concepts",
        "content": [
            "Training Data - examples the model learns from",
            "Features - input variables for predictions",
            "Model - the learned pattern or function",
            "Prediction - output from the trained model"
        ],
        "speaker_notes": "Let's understand some key terms. Training data is what we teach the model with. Features are the characteristics we use to make predictions. The model is what captures the learned patterns. Predictions are the outputs we get from our trained model."
    },
    {
        "id": 5,
        "title": "Getting Started with ML",
        "content": [
            "Learn Python programming basics",
            "Understand statistics and linear algebra",
            "Explore libraries: scikit-learn, TensorFlow, PyTorch",
            "Practice with datasets from Kaggle"
        ],
        "speaker_notes": "Want to get started? Begin with Python, it's the most popular language for ML. Brush up on math fundamentals. Then explore popular libraries like scikit-learn for beginners or TensorFlow and PyTorch for deep learning. Kaggle has great datasets to practice with."
    },
    {
        "id": 6,
        "title": "Summary & Questions",
        "content": [
            "ML enables computers to learn from data",
            "Three types: Supervised, Unsupervised, Reinforcement",
            "Applications are everywhere in our daily lives",
            "Getting started is easier than ever!",
            "Any questions?"
        ],
        "speaker_notes": "To wrap up: Machine Learning is transforming how computers solve problems by learning from data. We covered the three main types and saw real-world applications. The field is accessible to anyone willing to learn. I'm happy to answer any questions you might have!"
    }
]


def get_all_slides():
    """Return all slides."""
    return SLIDES


def get_slide(slide_id: int):
    """Return a specific slide by ID (1-indexed)."""
    if 1 <= slide_id <= len(SLIDES):
        return SLIDES[slide_id - 1]
    return None


def get_slide_count():
    """Return total number of slides."""
    return len(SLIDES)


def get_slides_context():
    """Return a summary of all slides for AI context."""
    context = "Presentation slides:\n"
    for slide in SLIDES:
        context += f"\nSlide {slide['id']}: {slide['title']}\n"
        for point in slide['content']:
            context += f"  - {point}\n"
    return context
