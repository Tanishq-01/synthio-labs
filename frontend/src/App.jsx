/**
 * AI Slide Presentation App (Gemini + Browser Speech APIs)
 */

import { useState, useEffect, useRef, useCallback } from "react";
import SlideViewer from "./components/SlideViewer";
import VoiceControls from "./components/VoiceControls";
import SlideNav from "./components/SlideNav";
import useSpeechRecognition from "./hooks/useVoiceRecorder";
import useWebSocket from "./hooks/useWebSocket";
import "./App.css";

const API_BASE = "http://localhost:8000";

export default function App() {
  // Slides state
  const [slides, setSlides] = useState([]);
  const [currentSlide, setCurrentSlide] = useState(1);
  const [isLoadingSlides, setIsLoadingSlides] = useState(true);

  // Conversation state
  const [conversationHistory, setConversationHistory] = useState([]);
  const [displayTranscript, setDisplayTranscript] = useState("");
  const [aiResponse, setAiResponse] = useState("");

  // Audio/Processing state
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  // Speech recognition hook
  const {
    isListening,
    transcript,
    error: speechError,
    startListening,
    stopListening,
    clearTranscript,
    isSupported,
  } = useSpeechRecognition();

  // WebSocket hook
  const { isConnected, sendInterrupt, sendSlideUpdate, sendSpeakingStatus } =
    useWebSocket();

  // Ref to track if we should process after listening stops
  const shouldProcessRef = useRef(false);

  // Fetch slides on mount
  useEffect(() => {
    fetchSlides();
  }, []);

  // Process transcript when listening stops and we have a transcript
  useEffect(() => {
    if (!isListening && transcript && shouldProcessRef.current) {
      shouldProcessRef.current = false;
      processTranscript(transcript);
    }
  }, [isListening, transcript]);

  const fetchSlides = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/slides`);
      const data = await response.json();
      setSlides(data.slides);
      setIsLoadingSlides(false);
    } catch (error) {
      console.error("Failed to fetch slides:", error);
      setIsLoadingSlides(false);
    }
  };

  const processTranscript = async (userText) => {
    if (!userText.trim()) return;

    setIsProcessing(true);
    setDisplayTranscript(userText);

    try {
      // Get AI response from Gemini
      const chatRes = await fetch(`${API_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userText,
          conversation_history: conversationHistory,
          current_slide: currentSlide,
        }),
      });
      const chatData = await chatRes.json();

      // Update conversation history
      setConversationHistory((prev) => [
        ...prev,
        { role: "user", content: userText },
        { role: "assistant", content: chatData.response },
      ]);

      setAiResponse(chatData.response);

      // Handle slide navigation
      if (chatData.new_slide !== currentSlide) {
        setCurrentSlide(chatData.new_slide);
        sendSlideUpdate(chatData.new_slide);
      }

      // Text to speech using browser API
      speak(chatData.response);
    } catch (error) {
      console.error("Error processing:", error);
      setAiResponse("Sorry, there was an error processing your request.");
    } finally {
      setIsProcessing(false);
      clearTranscript();
    }
  };

  // Browser-based text-to-speech
  const speak = (text) => {
    if (!("speechSynthesis" in window)) {
      console.error("Speech synthesis not supported");
      return;
    }

    // Cancel any ongoing speech
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    // Try to use a nice voice
    const voices = window.speechSynthesis.getVoices();
    const preferredVoice = voices.find(
      (v) => v.name.includes("Google") || v.name.includes("Samantha")
    );
    if (preferredVoice) {
      utterance.voice = preferredVoice;
    }

    utterance.onstart = () => {
      setIsSpeaking(true);
      sendSpeakingStatus(true);
    };

    utterance.onend = () => {
      setIsSpeaking(false);
      sendSpeakingStatus(false);
    };

    utterance.onerror = () => {
      setIsSpeaking(false);
      sendSpeakingStatus(false);
    };

    window.speechSynthesis.speak(utterance);
  };

  const handleStartListening = useCallback(() => {
    shouldProcessRef.current = true;
    startListening();
  }, [startListening]);

  const handleStopListening = useCallback(() => {
    stopListening();
    // Processing will happen in the useEffect when isListening becomes false
  }, [stopListening]);

  const handleInterrupt = useCallback(() => {
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
    sendInterrupt();
    sendSpeakingStatus(false);
  }, [sendInterrupt, sendSpeakingStatus]);

  const handleNavigate = useCallback(
    (slideNumber) => {
      const newSlide = Math.max(1, Math.min(slideNumber, slides.length));
      setCurrentSlide(newSlide);
      sendSlideUpdate(newSlide);
    },
    [slides.length, sendSlideUpdate]
  );

  const handleStartPresentation = async () => {
    setIsProcessing(true);
    try {
      const response = await fetch(`${API_BASE}/api/narrate/${currentSlide}`);
      const data = await response.json();
      setAiResponse(data.narration);
      speak(data.narration);
    } catch (error) {
      console.error("Error starting presentation:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  const currentSlideData = slides[currentSlide - 1];

  return (
    <div className="app">
      <header className="app-header">
        <h1>AI Slide Presentation</h1>
        <div className="connection-status">
          <span className={`status-dot ${isConnected ? "connected" : ""}`} />
          {isConnected ? "Connected" : "Disconnected"}
        </div>
      </header>

      <main className="app-main">
        <SlideViewer slide={currentSlideData} isLoading={isLoadingSlides} />

        <SlideNav
          currentSlide={currentSlide}
          totalSlides={slides.length}
          onNavigate={handleNavigate}
          disabled={isProcessing || isSpeaking}
        />

        <div className="ai-response">
          {aiResponse && (
            <>
              <p className="response-label">AI:</p>
              <p className="response-text">{aiResponse}</p>
            </>
          )}
        </div>

        <VoiceControls
          isRecording={isListening}
          isSpeaking={isSpeaking}
          isProcessing={isProcessing}
          onStartRecording={handleStartListening}
          onStopRecording={handleStopListening}
          onInterrupt={handleInterrupt}
          transcript={displayTranscript || transcript}
        />

        {speechError && <p className="error-message">{speechError}</p>}
        {!isSupported && (
          <p className="error-message">
            Speech recognition is not supported in this browser. Please use
            Chrome.
          </p>
        )}

        <button
          className="start-btn"
          onClick={handleStartPresentation}
          disabled={isProcessing || isSpeaking || isLoadingSlides}
        >
          {currentSlide === 1 ? "Start Presentation" : "Narrate This Slide"}
        </button>
      </main>

      <footer className="app-footer">
        <p>Speak to ask questions or navigate slides (Chrome recommended)</p>
      </footer>
    </div>
  );
}
