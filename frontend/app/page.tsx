'use client';

import { useState } from 'react';
import ScanForm from '@/components/ScanForm';
import NarrationFeed from '@/components/NarrationFeed';
import ScanStatusCard from '@/components/ScanStatusCard';
import { Scan } from '@/types/scan';

export default function Home() {
  const [currentScan, setCurrentScan] = useState<Scan | null>(null);
  const [scanId, setScanId] = useState<string | null>(null);

  const handleScanCreated = (scan: Scan) => {
    setCurrentScan(scan);
    setScanId(scan.id);
  };

  const handleScanUpdate = (updatedScan: Scan) => {
    setCurrentScan(updatedScan);
  };

  return (
    <div className="container">
      <header className="header">
        <h1>🔐 Secure-Contract</h1>
        <p>AI-Driven Smart Contract Risk Analysis</p>
      </header>

      <main className="main">
        <div className="grid">
          <div className="col-left">
            <ScanForm onScanCreated={handleScanCreated} />
            {currentScan && (
              <ScanStatusCard scan={currentScan} onUpdate={handleScanUpdate} />
            )}
          </div>

          <div className="col-right">
            {scanId && (
              <NarrationFeed scanId={scanId} onUpdate={handleScanUpdate} />
            )}
          </div>
        </div>
      </main>

      <footer className="footer">
        <p>INCUBATEX Hackathon 2024 | Incremental Narration Technology</p>
      </footer>
    </div>
  );
}