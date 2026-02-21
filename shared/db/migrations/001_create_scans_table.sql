-- Create the Scans table
CREATE TABLE IF NOT EXISTS scans (
    id UUID PRIMARY KEY,
    contract_address VARCHAR(42),
    network VARCHAR(20),
    status VARCHAR(20) DEFAULT 'pending', -- pending, processing, completed, failed
    results JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for faster lookups by contract address
CREATE INDEX IF NOT EXISTS idx_scans_contract_address ON scans(contract_address);