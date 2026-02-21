export interface NarrationEntry {
  stage: string;
  text: string;
  timestamp?: string;
}

export interface ScanResults {
  slither?: any;
  mythril?: any;
  gnn?: any;
  forge?: any;
}

export interface Scan {
  id: string;
  contract_address: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  results: ScanResults;
  narration_log: NarrationEntry[];
  final_score: number | null;
  created_at?: string;
  updated_at?: string;
}

export interface SSEMessage {
  type: 'narration' | 'status' | 'score' | 'complete' | 'error';
  data: any;
}