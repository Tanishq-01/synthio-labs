/**
 * useSpeechRecognition - Custom hook for browser-based speech recognition
 * Supports continuous listening mode for voice interruption detection.
 */

import { useState, useRef, useCallback, useEffect } from "react";

const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition;

export default function useSpeechRecognition() {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [finalTranscript, setFinalTranscript] = useState("");
  const [error, setError] = useState(null);

  const recognitionRef = useRef(null);
  const onSpeechDetectedRef = useRef(null);
  const continuousModeRef = useRef(false);

  useEffect(() => {
    if (!SpeechRecognition) {
      setError("Speech recognition is not supported in this browser.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true; // Keep listening
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onstart = () => {
      setIsListening(true);
      setError(null);
    };

    recognition.onresult = (event) => {
      let interim = "";
      let final = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          final += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }

      setTranscript(interim);

      if (final) {
        setFinalTranscript(final);
        // Notify that speech was detected (for interruption)
        if (onSpeechDetectedRef.current) {
          onSpeechDetectedRef.current(final);
        }
      }
    };

    recognition.onerror = (event) => {
      console.error("Speech recognition error:", event.error);
      if (event.error === "not-allowed") {
        setError("Microphone access denied.");
      } else if (event.error === "no-speech") {
        // Restart in continuous mode
        if (continuousModeRef.current && recognitionRef.current) {
          try {
            recognitionRef.current.start();
          } catch (e) {
            // Already started
          }
        }
      } else if (event.error !== "aborted") {
        setError(`Speech error: ${event.error}`);
      }
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
      // Restart if in continuous mode
      if (continuousModeRef.current) {
        try {
          recognition.start();
        } catch (e) {
          // Already started or other error
        }
      }
    };

    recognitionRef.current = recognition;

    return () => {
      continuousModeRef.current = false;
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
    };
  }, []);

  // Start listening (one-shot mode)
  const startListening = useCallback(() => {
    if (!recognitionRef.current) return;

    continuousModeRef.current = false;
    setTranscript("");
    setFinalTranscript("");
    setError(null);

    try {
      recognitionRef.current.stop();
    } catch (e) {}

    setTimeout(() => {
      try {
        recognitionRef.current.start();
      } catch (e) {
        console.error("Error starting recognition:", e);
      }
    }, 100);
  }, []);

  // Stop listening
  const stopListening = useCallback(() => {
    continuousModeRef.current = false;
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
  }, []);

  // Start continuous listening (for interruption detection)
  const startContinuousListening = useCallback((onSpeechDetected) => {
    if (!recognitionRef.current) return;

    continuousModeRef.current = true;
    onSpeechDetectedRef.current = onSpeechDetected;
    setTranscript("");
    setFinalTranscript("");
    setError(null);

    try {
      recognitionRef.current.start();
    } catch (e) {
      // Might already be running
    }
  }, []);

  // Stop continuous listening
  const stopContinuousListening = useCallback(() => {
    continuousModeRef.current = false;
    onSpeechDetectedRef.current = null;
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {}
    }
  }, []);

  const clearTranscript = useCallback(() => {
    setTranscript("");
    setFinalTranscript("");
  }, []);

  return {
    isListening,
    transcript,
    finalTranscript,
    error,
    startListening,
    stopListening,
    startContinuousListening,
    stopContinuousListening,
    clearTranscript,
    isSupported: !!SpeechRecognition,
  };
}
