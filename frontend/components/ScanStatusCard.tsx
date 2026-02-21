'use client';

import { useEffect, useState } from 'react';
import { Scan } from '@/types/scan';
import { getScan } from '@/lib/api';

interface ScanStatusCardProps {
  scan: Scan;
  onUpdate: (scan: Scan) => void;
}

export default function ScanStatusCard({ scan, onUpdate }: ScanStatusCardProps) {
  const [currentStage, setCurrentStage] = useState<string>('Initializing');

  useEffect(() => {
    // Determine current stage based on narration log
    if (scan.narration_log && scan.narration_log.length > 0) {
      const lastEntry = scan.narration_log[scan.narration_log.length - 1];
      setCurrentStage(lastEntry.stage);
    }
  }, [scan.narration_log]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return 'status-pending';
      case 'processing':
        return 'status-processing';
      case 'completed':
        return 'status-completed';
      case 'failed':
        return 'status-failed';
      default:
        return 'status-pending';
    }
  };

  const getStageIcon = () => {
    if (scan.status === 'completed') return '✅';
    if (scan.status === 'failed') return '❌';
    if (scan.status === 'processing') return '⚙️';
    return '⏳';
  };

  return (
    <div className="card">
      <h2>📊 Scan Status</h2>

      <div className="info-row">
        <span className="info-label">Scan ID:</span>
        <span className="info-value">{scan.id.substring(0, 8)}...</span>
      </div>

      <div className="info-row">
        <span className="info-label">Contract:</span>
        <span className="info-value">
          {scan.contract_address.substring(0, 10)}...
          {scan.contract_address.substring(scan.contract_address.length - 8)}
        </span>
      </div>

      <div className="info-row">
        <span className="info-label">Status:</span>
        <span className={`status-badge ${getStatusColor(scan.status)}`}>
          {scan.status}
        </span>
      </div>

      {scan.status === 'processing' && (
        <div className="stage-indicator">
          <span className="stage-icon">{getStageIcon()}</span>
          <span className="stage-text">
            {currentStage === 'slither' && 'Running Static Analysis (Slither)'}
            {currentStage === 'mythril' && 'Executing Symbolic Analysis (Mythril)'}
            {currentStage === 'gnn' && 'Analyzing with Graph Neural Network'}
            {(currentStage === 'forge' || currentStage === 'simulation') &&
              'Running Foundry Simulation'}
            {!['slither', 'mythril', 'gnn', 'forge', 'simulation'].includes(
              currentStage
            ) && 'Processing...'}
          </span>
          <span className="loader"></span>
        </div>
      )}

      {scan.status === 'processing' && !scan.final_score && (
        <div className="waiting-indicator">
          <span className="loader"></span>
          <span className="waiting-text">
            Awaiting results from security analysis tools...
          </span>
        </div>
      )}

      {scan.final_score !== null && scan.final_score !== undefined && (
        <div className="score-display">
          <div className="score-label">Security Score</div>
          <div className="score-value">{scan.final_score}</div>
          <div className="score-label">out of 100</div>
        </div>
      )}

      {scan.status === 'failed' && (
        <div className="error-message">
          ⚠️ Analysis failed. Please try again or check contract address.
        </div>
      )}

      {scan.status === 'completed' && (
        <div className="stage-indicator" style={{ background: '#d1fae5' }}>
          <span className="stage-icon">✅</span>
          <span className="stage-text" style={{ color: '#065f46' }}>
            Analysis Complete
          </span>
        </div>
      )}
    </div>
  );
}