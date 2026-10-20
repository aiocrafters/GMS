-- =====================================================================
--  create_representation_workflow_records.sql
--  Creates public.representation_workflow_records table with full
--  constraints, indexes, trigger, and Row Level Security (RLS) policies.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.representation_workflow_records (
    uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Foreign keys & identifiers referencing registered_representations & parents
    registered_representations_uuid UUID REFERENCES public.registered_representations(uuid) ON DELETE CASCADE,
    e_office_files_uuid UUID NOT NULL REFERENCES public.e_office_files(uuid) ON DELETE RESTRICT,
    e_office_computer_number VARCHAR(100),
    e_office_file_number VARCHAR(255),
    received_communications_uuid UUID NOT NULL REFERENCES public.received_communications(uuid) ON DELETE RESTRICT,
    communication_number TEXT,
    communication_date DATE,
    representation_serial_number INTEGER NOT NULL,
    applicant_name TEXT NOT NULL,
    representation_subject TEXT NOT NULL,
    processing_channel TEXT NOT NULL,
    processing_channel_id_number TEXT NULL,
    
    -- Workflow classification (strictly enforced)
    workflow_type TEXT NOT NULL CHECK (
        workflow_type IN (
            'Forward to Concerned',
            'ATR Status',
            'ATR Submitted to Original Source'
        )
    ),
    
    -- Workflow-Specific Fields: Forward to Concerned
    forwarded_to_department TEXT NULL,
    forwarding_date DATE NULL,
    forwarding_dispatch_number TEXT NULL,
    forwarding_remarks TEXT NULL,
    
    -- Workflow-Specific Fields: ATR Status
    atr_status TEXT NULL CHECK (
        atr_status IS NULL OR atr_status IN ('Pending', 'Received', 'Under Consideration')
    ),
    atr_receipt_date DATE NULL,
    atr_reference_number TEXT NULL,
    atr_remarks TEXT NULL,
    
    -- Workflow-Specific Fields: ATR Submitted to Original Source
    atr_submission_date DATE NULL,
    atr_submitted_to TEXT NULL,
    atr_dispatch_number TEXT NULL,
    atr_submission_remarks TEXT NULL,
    
    -- General remarks
    remarks TEXT NULL,
    
    -- Audit & soft-deletion timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    deleted_at TIMESTAMPTZ NULL,
    created_by TEXT NULL,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    deleted_by TEXT NULL
);

-- Indexes for high-performance filtering, joins, and sorting
CREATE INDEX IF NOT EXISTS idx_rep_wf_e_office_files_uuid 
    ON public.representation_workflow_records(e_office_files_uuid);

CREATE INDEX IF NOT EXISTS idx_rep_wf_received_comm_uuid 
    ON public.representation_workflow_records(received_communications_uuid);

CREATE INDEX IF NOT EXISTS idx_rep_wf_registered_rep_uuid 
    ON public.representation_workflow_records(registered_representations_uuid);

CREATE INDEX IF NOT EXISTS idx_rep_wf_workflow_type 
    ON public.representation_workflow_records(workflow_type);

CREATE INDEX IF NOT EXISTS idx_rep_wf_is_deleted 
    ON public.representation_workflow_records(is_deleted);

CREATE INDEX IF NOT EXISTS idx_rep_wf_created_at 
    ON public.representation_workflow_records(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rep_wf_comm_serial 
    ON public.representation_workflow_records(received_communications_uuid, representation_serial_number);

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION public.handle_workflow_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc', now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_representation_workflow_records_updated_at 
    ON public.representation_workflow_records;

CREATE TRIGGER trg_representation_workflow_records_updated_at
    BEFORE UPDATE ON public.representation_workflow_records
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_workflow_updated_at();

-- Enable Row Level Security (RLS)
ALTER TABLE public.representation_workflow_records ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Allow authenticated full access to representation_workflow_records" 
    ON public.representation_workflow_records;

CREATE POLICY "Allow authenticated full access to representation_workflow_records" 
    ON public.representation_workflow_records 
    FOR ALL 
    TO authenticated 
    USING (true) 
    WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon read and write to representation_workflow_records" 
    ON public.representation_workflow_records;

CREATE POLICY "Allow anon read and write to representation_workflow_records" 
    ON public.representation_workflow_records 
    FOR ALL 
    TO anon 
    USING (true) 
    WITH CHECK (true);
