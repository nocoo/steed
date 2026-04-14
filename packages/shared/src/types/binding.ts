/**
 * Agent to Data Source binding
 */
export interface Binding {
  agent_id: string;
  data_source_id: string;
  created_at: string;
}

/**
 * Request payload for creating a binding
 */
export interface CreateBindingRequest {
  agent_id: string;
  data_source_id: string;
}
