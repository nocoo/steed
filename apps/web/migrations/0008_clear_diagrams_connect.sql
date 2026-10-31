-- Phase 0: start the topology platform from an empty workspace.
-- Clear diagrams and all Connect state in foreign-key order; keep connect_audit.
DELETE FROM connect_requests;
DELETE FROM connect_confirmations;
DELETE FROM connect_rate_limits;
DELETE FROM connect_tokens;
DELETE FROM diagrams;
