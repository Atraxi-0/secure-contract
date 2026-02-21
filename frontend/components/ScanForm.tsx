'use client';

import { useState, FormEvent } from 'react';
import { createScan } from '@/lib/api';
import { Scan } from '@/types/scan';

interface ScanFormProps {
  onScanCreated: (scan: Scan) => void;
}

export default function ScanForm({ onScanCreated }: ScanFormProps) {
  const [contractAddress, setContractAddress] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!contractAddress.trim()) {
      setError('Please enter a contract address');
      return;
    }

    if (!contractAddress.startsWith('0x')) {
      setError('Contract address must start with 0x');
      return;
    }

    setIsSubmitting(true);

    try {
      const scan = await createScan(contractAddress);
      onScanCreated(scan);
      setContractAddress('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create scan');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="card">
      <h2>🚀 Submit Contract for Analysis</h2>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="contractAddress">Smart Contract Address</label>
          <input
            type="text"
            id="contractAddress"
            placeholder="0x..."
            value={contractAddress}
            onChange={(e) => setContractAddress(e.target.value)}
            disabled={isSubmitting}
          />
        </div>

        {error && <div className="error-message">{error}</div>}

        <button type="submit" className="btn" disabled={isSubmitting}>
          {isSubmitting ? (
            <>
              <span className="loader" style={{ marginRight: '0.5rem' }}></span>
              Creating Scan...
            </>
          ) : (
            'Start Security Analysis'
          )}
        </button>
      </form>
    </div>
  );
}