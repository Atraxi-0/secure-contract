import { Scan } from '@/types/scan';

const API_BASE_URL = 'http://localhost:3000';

export async function createScan(contractAddress: string): Promise<Scan> {
  const response = await fetch(`${API_BASE_URL}/api/v1/scans`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ contract_address: contractAddress }),
  });

  if (!response.ok) {
    throw new Error('Failed to create scan');
  }

  return response.json();
}

export async function getScan(scanId: string): Promise<Scan> {
  const response = await fetch(`${API_BASE_URL}/api/v1/scans/${scanId}`);

  if (!response.ok) {
    throw new Error('Failed to fetch scan');
  }

  return response.json();
}

export function createSSEConnection(scanId: string): EventSource {
  return new EventSource(`${API_BASE_URL}/api/v1/scans/${scanId}/stream`);
}

export async function checkHealth(): Promise<any> {
  const response = await fetch(`${API_BASE_URL}/health`);
  return response.json();
}