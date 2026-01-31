/**
 * AI Presentation Agent - Simple autonomous presenter with manual Q&A
 */

import { useState, useEffect, useRef, useCallback } from "react";
import SlideViewer from "./components/SlideViewer";
import SlideNav from "./components/SlideNav";
import useWebSocket from "./hooks/useWebSocket";
import "./App.css";

const API_BASE = "http://localhost:8000";

// Load past presentations from localStorage
const loadPastPresentations = () => {
  try {
    const saved = localStorage.getItem("pastPresentations");
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
};

// Save past presentations to localStorage
const savePastPresentations = (presentations) => {
  try {
    localStorage.setItem("pastPresentations", JSON.stringify(presentations));
  } catch (e) {
    console.error("Failed to save presentations:", e);
  }
};

export default function App() {
  // Sidebar state
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pastPresentations, setPastPresentations] = useState(loadPastPresentations);

  // Topic state
  const [topic, setTopic] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [hasSlides, setHasSlides] = useState(false);

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
      setHasSlides(data.slides && data.slides.length > 0);
      setIsLoadingSlides(false);
    } catch (error) {
      console.error("Failed to fetch slides:", error);
      setIsLoadingSlides(false);
    }
  };

  const generateSlides = async (e) => {
    e.preventDefault();
    if (!topic.trim()) return;

    setIsGenerating(true);
    try {
      const response = await fetch(`${API_BASE}/api/topic`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: topic.trim(), num_slides: 6 }),
      });

      if (!response.ok) {
        throw new Error("Failed to generate slides");
      }

      const data = await response.json();
      setSlides(data.slides);
      setHasSlides(true);
      setCurrentSlide(1);

      // Save to past presentations
      const newPresentation = {
        id: Date.now(),
        topic: topic.trim(),
        slides: data.slides,
        createdAt: new Date().toISOString(),
      };
      const updated = [newPresentation, ...pastPresentations].slice(0, 20); // Keep last 20
      setPastPresentations(updated);
      savePastPresentations(updated);
    } catch (error) {
      console.error("Failed to generate slides:", error);
      alert("Failed to generate slides. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  };

  const loadPresentation = (presentation) => {
    setTopic(presentation.topic);
    setSlides(presentation.slides);
    setHasSlides(true);
    setCurrentSlide(1);
    setAiResponse("");
    setIsPresenting(false);
    setSidebarOpen(false);
  };

  const deletePresentation = (id, e) => {
    e.stopPropagation();
    const updated = pastPresentations.filter((p) => p.id !== id);
    setPastPresentations(updated);
    savePastPresentations(updated);
  };

  const resetPresentation = () => {
    setSlides([]);
    setHasSlides(false);
    setTopic("");
    setCurrentSlide(1);
    setAiResponse("");
    setIsPresenting(false);
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

  const resumePresentation = useCallback(async () => {
    if (!shouldContinueRef.current || !isPresentingRef.current) return;

    try {
      const response = await fetch(`${API_BASE}/api/present/slide/${currentSlideRef.current}`);
      const data = await response.json();

      if (!shouldContinueRef.current) return;

      const resumeNarration = "Let me continue where we left off. " + data.narration;
      setAiResponse(resumeNarration);

      await speak(resumeNarration);

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
      console.error("Error resuming:", error);
    }
  }, [speak, continuePresentation]);

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

      if (isPresentingRef.current) {
        shouldContinueRef.current = true;
        setTimeout(() => {
          if (isPresentingRef.current && shouldContinueRef.current) {
            resumePresentation();
          }
        }, 1000);
      }
    } catch (error) {
      console.error("Error:", error);
    } finally {
      setIsProcessing(false);
      setTranscript("");
    }
  }, [speak, sendSlideUpdate, resumePresentation]);

  const askQuestion = useCallback(() => {
    if (isRecording) {
      recognitionRef.current?.stop();
      transcriptRef.current = "";
      setTranscript("");
      return;
    }

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

  // Sidebar component
  const Sidebar = () => (
    <>
      <div
        className={`sidebar-overlay ${sidebarOpen ? "open" : ""}`}
        onClick={() => setSidebarOpen(false)}
      />
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-header">
          <h2>History</h2>
          <button className="sidebar-close" onClick={() => setSidebarOpen(false)}>
            ✕
          </button>
        </div>
        <div className="sidebar-content">
          {pastPresentations.length === 0 ? (
            <p className="sidebar-empty">No past presentations yet</p>
          ) : (
            <ul className="presentation-list">
              {pastPresentations.map((p) => (
                <li
                  key={p.id}
                  className="presentation-item"
                  onClick={() => loadPresentation(p)}
                >
                  <div className="presentation-info">
                    <span className="presentation-topic">{p.topic}</span>
                    <span className="presentation-date">
                      {new Date(p.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <button
                    className="delete-btn"
                    onClick={(e) => deletePresentation(p.id, e)}
                    title="Delete"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </>
  );

  // Show topic input if no slides
  if (!hasSlides && !isLoadingSlides) {
    return (
      <div className="app-container">
        <Sidebar />
        <div className="app">
          <header className="app-header">
            <button className="menu-btn" onClick={() => setSidebarOpen(true)}>
              ☰
            </button>
            <h1>AI Presentation Agent</h1>
            <div className="header-spacer" />
          </header>

          <main className="app-main topic-setup">
            <div className="topic-form-container">
              <h2>Create Your Presentation</h2>
              <p className="topic-description">
                Enter a topic and the AI will generate a personalized presentation just for you.
              </p>

              <form onSubmit={generateSlides} className="topic-form">
                <div className="form-group">
                  <label htmlFor="topic">Presentation Topic</label>
                  <input
                    id="topic"
                    type="text"
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    placeholder="e.g., Introduction to Machine Learning"
                    disabled={isGenerating}
                    autoFocus
                  />
                </div>

                <button
                  type="submit"
                  className="generate-btn"
                  disabled={isGenerating || !topic.trim()}
                >
                  {isGenerating ? "Generating..." : "Generate Presentation"}
                </button>
              </form>
            </div>
          </main>

          <footer className="app-footer">
            <p>Powered by AI • 1:1 Personalized Presentations</p>
          </footer>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      <Sidebar />
      <div className="app">
        <header className="app-header">
          <button className="menu-btn" onClick={() => setSidebarOpen(true)}>
            ☰
          </button>
          <h1>AI Presentation Agent</h1>
          <div className="header-status">
            <span className={`status-dot ${isConnected ? "connected" : ""}`} />
            {isPresenting ? "Presenting" : "Ready"}
            {!isPresenting && (
              <button className="new-topic-btn" onClick={resetPresentation}>
                New Topic
              </button>
            )}
          </div>
        </header>

        <main className="app-main">
          <SlideViewer slide={currentSlideData} isLoading={isLoadingSlides} />

          {isPresenting && (
            <div className="presenting-indicator">
              <span className="presenting-dot"></span>
              Presenting Slide {currentSlide} of {slides.length}
            </div>
          )}

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

          {transcript && (
            <div className="live-transcript">
              🎤 {transcript}
            </div>
          )}

          <div className="controls-section">
            {isSpeaking && (
              <button className="stop-btn" onClick={stopAgent}>
                ⏹ Stop AI
              </button>
            )}

            <button
              className={`ask-btn ${isRecording ? "recording" : ""}`}
              onClick={askQuestion}
              disabled={isProcessing}
            >
              {isRecording ? "🔴 Listening... (click to cancel)" : "🎤 Ask Question"}
            </button>
          </div>

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
    </div>
  );
}
