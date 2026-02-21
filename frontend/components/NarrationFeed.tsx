'use client';

import { useEffect, useState, useRef } from 'react';
import { createSSEConnection, getScan } from '@/lib/api';
import { Scan, NarrationEntry, SSEMessage } from '@/types/scan';

interface NarrationFeedProps {
  scanId: string;
  onUpdate: (scan: Scan) => void;
}

export default function NarrationFeed({ scanId, onUpdate }: NarrationFeedProps) {
  const [narrations, setNarrations] = useState<NarrationEntry[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let eventSource: EventSource | null = null;

    const connectSSE = () => {
      setError(null);
      
      try {
        eventSource = createSSEConnection(scanId);
        eventSourceRef.current = eventSource;

        eventSource.onopen = () => {
          setIsConnected(true);
          console.log('SSE connection established');
        };

        eventSource.onmessage = (event) => {
          try {
            const message: SSEMessage = JSON.parse(event.data);

            if (message.type === 'narration') {
              const newNarration: NarrationEntry = {
                stage: message.data.stage || 'unknown',
                text: message.data.text || message.data.message || '',
                timestamp: new Date().toISOString(),
              };
              
              setNarrations((prev) => [...prev, newNarration]);
            }

            // Fetch updated scan data
            getScan(scanId).then((updatedScan) => {
              onUpdate(updatedScan);
            }).catch(console.error);

          } catch (err) {
            console.error('Failed to parse SSE message:', err);
          }
        };

        eventSource.onerror = (err) => {
          console.error('SSE error:', err);
          setIsConnected(false);
          setError('Connection lost. Retrying...');
          
          // Close and attempt reconnect after delay
          eventSource?.close();
          setTimeout(() => {
            if (eventSourceRef.current === eventSource) {
              connectSSE();
            }
          }, 3000);
        };

      } catch (err) {
        console.error('Failed to create SSE connection:', err);
        setError('Failed to establish connection');
      }
    };

    // Initial connection
    connectSSE();

    // Cleanup function
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [scanId, onUpdate]);

  const getStageEmoji = (stage: string) => {
    const lowerStage = stage.toLowerCase();
    if (lowerStage.includes('slither')) return '🔍';
    if (lowerStage.includes('mythril')) return '🔮';
    if (lowerStage.includes('gnn')) return '🧠';
    if (lowerStage.includes('forge') || lowerStage.includes('simulation')) return '⚡';
    if (lowerStage.includes('final') || lowerStage.includes('complete')) return '✅';
    return '📝';
  };

  return (
    <div className="card">
      <h2>📡 Live Analysis Feed</h2>

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      {!isConnected && !error && (
        <div className="waiting-indicator">
          <span className="loader"></span>
          <span className="waiting-text">Connecting to analysis stream...</span>
        </div>
      )}

      <div className="narration-container">
        {narrations.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">⏳</div>
            <p>Waiting for analysis to begin...</p>
            <p style={{ fontSize: '0.9rem', marginTop: '0.5rem' }}>
              Results will appear here in real-time
            </p>
          </div>
        ) : (
          narrations.map((narration, index) => (
            <div key={index} className="narration-entry">
              <div className="narration-stage">
                {getStageEmoji(narration.stage)} {narration.stage}
              </div>
              <div className="narration-text">{narration.text}</div>
            </div>
          ))
        )}
      </div>

      {isConnected && narrations.length > 0 && (
        <div
          className="stage-indicator"
          style={{ marginTop: '1rem', background: '#dbeafe' }}
        >
          <span className="stage-icon">🔄</span>
          <span className="stage-text" style={{ color: '#1e40af' }}>
            Stream Active - Updates in real-time
          </span>
        </div>
      )}
    </div>
  );
}