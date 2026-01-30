/**
 * VoiceControls - Recording and playback controls
 */

export default function VoiceControls({
  isRecording,
  isSpeaking,
  isProcessing,
  onStartRecording,
  onStopRecording,
  onInterrupt,
  transcript,
}) {
  const handleMainButton = () => {
    if (isSpeaking) {
      onInterrupt();
    } else if (isRecording) {
      onStopRecording();
    } else {
      onStartRecording();
    }
  };

  const getButtonText = () => {
    if (isProcessing) return "Processing...";
    if (isSpeaking) return "Stop AI";
    if (isRecording) return "Stop Recording";
    return "Start Speaking";
  };

  const getButtonClass = () => {
    if (isSpeaking) return "control-btn speaking";
    if (isRecording) return "control-btn recording";
    if (isProcessing) return "control-btn processing";
    return "control-btn idle";
  };

  return (
    <div className="voice-controls">
      <button
        className={getButtonClass()}
        onClick={handleMainButton}
        disabled={isProcessing}
      >
        <span className="btn-icon">
          {isSpeaking ? "⏹" : isRecording ? "⏹" : "🎤"}
        </span>
        <span className="btn-text">{getButtonText()}</span>
      </button>

      {transcript && (
        <div className="transcript-display">
          <p className="transcript-label">You said:</p>
          <p className="transcript-text">{transcript}</p>
        </div>
      )}

      <div className="status-indicator">
        {isRecording && (
          <span className="status recording">
            <span className="pulse"></span>
            Recording...
          </span>
        )}
        {isSpeaking && (
          <span className="status speaking">
            <span className="wave"></span>
            AI is speaking...
          </span>
        )}
        {isProcessing && (
          <span className="status processing">
            <span className="spinner"></span>
            Processing...
          </span>
        )}
      </div>
    </div>
  );
}
