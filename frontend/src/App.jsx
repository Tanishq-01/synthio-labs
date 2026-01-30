/**
 * AI Presentation Agent - Simple autonomous presenter with manual Q&A
 */

import { useState, useEffect, useRef, useCallback } from "react";
import SlideViewer from "./components/SlideViewer";
import SlideNav from "./components/SlideNav";
import useWebSocket from "./hooks/useWebSocket";
import "./App.css";

const API_BASE = "http://localhost:8000";

export default function App() {
  // Slides state
  const [slides, setSlides] = useState([]);
  const [currentSlide, setCurrentSlide] = useState(1);
  const [isLoadingSlides, setIsLoadingSlides] = useState(true);

  // Agent state
  const [isPresenting, setIsPresenting] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [aiResponse, setAiResponse] = useState("");

  // Question state
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const transcriptRef = useRef("");

  // WebSocket
  const { isConnected, sendInterrupt, sendSlideUpdate, sendSpeakingStatus } =
    useWebSocket();

  // Refs
  const isPresentingRef = useRef(false);
  const shouldContinueRef = useRef(true);
  const currentSlideRef = useRef(1);
  const recognitionRef = useRef(null);

  // Fetch slides on mount
  useEffect(() => {
    fetchSlides();
    initSpeechRecognition();
  }, []);

  useEffect(() => {
    isPresentingRef.current = isPresenting;
  }, [isPresenting]);

  useEffect(() => {
    currentSlideRef.current = currentSlide;
  }, [currentSlide]);

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

  // Simple speech recognition setup
  const initSpeechRecognition = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      let text = "";
      for (let i = 0; i < event.results.length; i++) {
        text += event.results[i][0].transcript;
      }
      transcriptRef.current = text;
      setTranscript(text);
    };

    recognition.onend = () => {
      setIsRecording(false);
      // Auto-send question when speech ends
      if (transcriptRef.current.trim()) {
        sendQuestion(transcriptRef.current);
        transcriptRef.current = "";
      }
    };

    recognitionRef.current = recognition;
  };

  // ============== Text-to-Speech ==============
  const speak = useCallback((text) => {
    return new Promise((resolve) => {
      if (!("speechSynthesis" in window)) {
        resolve();
        return;
      }

      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.0;

      const voices = window.speechSynthesis.getVoices();
      const voice = voices.find(v => v.name.includes("Google") || v.name.includes("Samantha"));
      if (voice) utterance.voice = voice;

      utterance.onstart = () => {
        setIsSpeaking(true);
        sendSpeakingStatus(true);
      };

      utterance.onend = () => {
        setIsSpeaking(false);
        sendSpeakingStatus(false);
        resolve();
      };

      utterance.onerror = () => {
        setIsSpeaking(false);
        sendSpeakingStatus(false);
        resolve();
      };

      window.speechSynthesis.speak(utterance);
    });
  }, [sendSpeakingStatus]);

  const stopSpeaking = useCallback(() => {
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
    sendSpeakingStatus(false);
  }, [sendSpeakingStatus]);

  // ============== Presentation Loop ==============
  const continuePresentation = useCallback(async () => {
    if (!shouldContinueRef.current || !isPresentingRef.current) return;

    try {
      const response = await fetch(`${API_BASE}/api/present/next`);
      const data = await response.json();

      if (!shouldContinueRef.current) return;

      setCurrentSlide(data.current_slide);
      setAiResponse(data.narration);
      sendSlideUpdate(data.current_slide);

      await speak(data.narration);

      if (data.has_next && shouldContinueRef.current && isPresentingRef.current) {
        setTimeout(() => {
          if (isPresentingRef.current && shouldContinueRef.current) {
            continuePresentation();
          }
        }, 500);
      } else if (!data.has_next) {
        setIsPresenting(false);
      }
    } catch (error) {
      console.error("Error:", error);
    }
  }, [speak, sendSlideUpdate]);

  // ============== Controls ==============
  const startPresentation = useCallback(async () => {
    setIsPresenting(true);
    shouldContinueRef.current = true;
    setIsProcessing(true);

    try {
      const response = await fetch(`${API_BASE}/api/present/start`);
      const data = await response.json();

      setCurrentSlide(data.current_slide);
      setAiResponse(data.narration);
      sendSlideUpdate(data.current_slide);

      await speak(data.narration);

      if (data.has_next && shouldContinueRef.current) {
        setTimeout(() => {
          if (isPresentingRef.current && shouldContinueRef.current) {
            continuePresentation();
          }
        }, 500);
      }
    } catch (error) {
      console.error("Error:", error);
    } finally {
      setIsProcessing(false);
    }
  }, [speak, sendSlideUpdate, continuePresentation]);

  const stopAgent = useCallback(() => {
    shouldContinueRef.current = false;
    stopSpeaking();
    sendInterrupt();
  }, [stopSpeaking, sendInterrupt]);

  const stopPresentation = useCallback(() => {
    shouldContinueRef.current = false;
    setIsPresenting(false);
    stopSpeaking();
    sendInterrupt();
  }, [stopSpeaking, sendInterrupt]);

  // ============== Question Handling ==============
  const sendQuestion = useCallback(async (question) => {
    setIsProcessing(true);
    try {
      const response = await fetch(`${API_BASE}/api/question`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          current_slide: currentSlideRef.current,
        }),
      });
      const data = await response.json();

      if (data.slide_changed) {
        setCurrentSlide(data.target_slide);
        sendSlideUpdate(data.target_slide);
      }

      setAiResponse(data.response);
      await speak(data.response);

      // Resume presentation if was presenting
      if (isPresentingRef.current) {
        shouldContinueRef.current = true;
        setTimeout(() => {
          if (isPresentingRef.current && shouldContinueRef.current) {
            continuePresentation();
          }
        }, 1000);
      }
    } catch (error) {
      console.error("Error:", error);
    } finally {
      setIsProcessing(false);
      setTranscript("");
    }
  }, [speak, sendSlideUpdate, continuePresentation]);

  const askQuestion = useCallback(() => {
    if (isRecording) {
      // Cancel recording
      recognitionRef.current?.stop();
      transcriptRef.current = "";
      setTranscript("");
      return;
    }

    // Start recording - interrupts AI
    stopSpeaking();
    shouldContinueRef.current = false;
    transcriptRef.current = "";
    setTranscript("");
    setIsRecording(true);
    recognitionRef.current?.start();
  }, [isRecording, stopSpeaking]);

  const handleNavigate = useCallback((slideNumber) => {
    const newSlide = Math.max(1, Math.min(slideNumber, slides.length));
    stopSpeaking();
    setCurrentSlide(newSlide);
    sendSlideUpdate(newSlide);
  }, [slides.length, stopSpeaking, sendSlideUpdate]);

  const currentSlideData = slides[currentSlide - 1];

  return (
    <div className="app">
      <header className="app-header">
        <h1>AI Presentation Agent</h1>
        <div className="header-status">
          <span className={`status-dot ${isConnected ? "connected" : ""}`} />
          {isPresenting ? "Presenting" : "Ready"}
        </div>
      </header>

      <main className="app-main">
        <SlideViewer slide={currentSlideData} isLoading={isLoadingSlides} />

        {/* Presenting Indicator - shows during presentation */}
        {isPresenting && (
          <div className="presenting-indicator">
            <span className="presenting-dot"></span>
            Presenting Slide {currentSlide} of {slides.length}
          </div>
        )}

        {/* Slide Navigation - hidden during presentation */}
        {!isPresenting && (
          <SlideNav
            currentSlide={currentSlide}
            totalSlides={slides.length}
            onNavigate={handleNavigate}
            disabled={isProcessing}
          />
        )}

        <div className="ai-response">
          {aiResponse && (
            <>
              <p className="response-label">AI Agent:</p>
              <p className="response-text">{aiResponse}</p>
            </>
          )}
        </div>

        {/* Recording transcript */}
        {transcript && (
          <div className="live-transcript">
            🎤 {transcript}
          </div>
        )}

        {/* Controls */}
        <div className="controls-section">
          {/* Stop AI button - only shows when speaking */}
          {isSpeaking && (
            <button className="stop-btn" onClick={stopAgent}>
              ⏹ Stop AI
            </button>
          )}

          {/* Single Ask Question button */}
          <button
            className={`ask-btn ${isRecording ? "recording" : ""}`}
            onClick={askQuestion}
            disabled={isProcessing}
          >
            {isRecording ? "🔴 Listening... (click to cancel)" : "🎤 Ask Question"}
          </button>
        </div>

        {/* Main presentation controls */}
        <div className="main-controls">
          {!isPresenting ? (
            <button
              className="start-btn"
              onClick={startPresentation}
              disabled={isProcessing || isLoadingSlides}
            >
              ▶ Start Presentation
            </button>
          ) : (
            <button className="stop-presentation-btn" onClick={stopPresentation}>
              ⏹ End Presentation
            </button>
          )}
        </div>
      </main>

      <footer className="app-footer">
        <p>
          {isPresenting
            ? "Click 'Ask Question' to interrupt • Question auto-sends when you stop speaking"
            : "Click Start to begin the AI presentation"}
        </p>
      </footer>
    </div>
  );
}
